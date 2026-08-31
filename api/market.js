import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const { action, user_id, item_type, action_type, amount, wallet_address } = req.body;

  if (!user_id) {
    return res.status(400).json({ success: false, error: 'Missing user ID!' });
  }

  const userIdStr = String(user_id);
  const now = new Date();

  try {
    // 1. ACTION: BUY SUPPLIES (Water / Fertilizer)
    if (action === 'buy_item' || action_type === 'BUY_ITEM') {
      let cost = item_type === 'WATER' ? 20 : (item_type === 'FERTILIZER' ? 50 : 0);
      if (cost === 0) return res.status(400).json({ success: false, error: 'Invalid item type.' });

      let { data: user } = await supabase.from('users').select('coins').eq('id', userIdStr).single();
      if (!user || user.coins < cost) {
        return res.status(400).json({ success: false, error: 'Insufficient coins!' });
      }

      let { data: farm } = await supabase.from('user_farms').select('*').eq('user_id', userIdStr).single();
      let updateData = { updated_at: now };
      if (item_type === 'WATER') updateData.water = (farm.water || 0) + 1;
      if (item_type === 'FERTILIZER') updateData.fertilizer = (farm.fertilizer || 0) + 1;

      await supabase.from('users').update({ coins: user.coins - cost }).eq('id', userIdStr);
      await supabase.from('user_farms').update(updateData).eq('user_id', userIdStr);
      
      await supabase.from('transactions').insert([{
        user_id: userIdStr,
        type: 'BUY_' + item_type,
        amount: -cost,
        description: `Purchased 1x ${item_type}`,
        created_at: now
      }]);

      return res.status(200).json({ success: true, message: `Successfully purchased 1x ${item_type}!` });
    }

    // 2. ACTION: TRANSACT MARKET (Sell Fruits / Exchange ATF)
    if (action === 'transact' || action_type === 'SELL_FRUITS' || action_type === 'EXCHANGE_ATF') {
      let { data: user } = await supabase.from('users').select('*').eq('id', userIdStr).single();
      let { data: farm } = await supabase.from('user_farms').select('*').eq('user_id', userIdStr).single();

      if (action_type === 'SELL_FRUITS') {
        let fruitsCount = farm.fruits || 0;
        if (fruitsCount <= 0) return res.status(400).json({ success: false, error: 'No fruits available to sell!' });

        let earnedCoins = fruitsCount * 45;
        await supabase.from('users').update({ coins: Number(user.coins) + earnedCoins }).eq('id', userIdStr);
        await supabase.from('user_farms').update({ fruits: 0, updated_at: now }).eq('user_id', userIdStr);

        await supabase.from('transactions').insert([{
          user_id: userIdStr,
          type: 'SELL_FRUITS',
          amount: earnedCoins,
          description: `Sold ${fruitsCount} fruits for ${earnedCoins} coins`,
          created_at: now
        }]);

        return res.status(200).json({ success: true, message: `Sold ${fruitsCount} fruits for ${earnedCoins} Coins!` });
      }

      if (action_type === 'EXCHANGE_ATF') {
        let requiredCoins = 500;
        if (Number(user.coins) < requiredCoins) {
          return res.status(400).json({ success: false, error: 'Need 500 Coins to exchange for 1 ATF!' });
        }

        await supabase.from('users').update({
          coins: Number(user.coins) - requiredCoins,
          atf_balance: Number(user.atf_balance || 0) + 1.0000,
          updated_at: now
        }).eq('id', userIdStr);

        await supabase.from('transactions').insert([{
          user_id: userIdStr,
          type: 'EXCHANGE_ATF',
          amount: 1.0000,
          description: `Exchanged 500 Coins for 1.0000 ATF`,
          created_at: now
        }]);

        return res.status(200).json({ success: true, message: `Successfully exchanged 500 Coins for 1.0000 ATF!` });
      }
    }

    // 3. ACTION: FETCH TRANSACTION HISTORY
    if (action === 'history') {
      let { data: txs, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userIdStr)
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) throw error;
      return res.status(200).json({ success: true, history: txs || [] });
    }

    // 4. ACTION: WITHDRAW ATF TOKENS
    if (action === 'withdraw') {
      let withdrawAmount = Number(amount);
      if (!withdrawAmount || withdrawAmount <= 0 || withdrawAmount > 500) {
        return res.status(400).json({ success: false, error: 'Invalid withdrawal amount (Max 500 ATF).' });
      }

      let { data: user } = await supabase.from('users').select('*').eq('id', userIdStr).single();
      if (!user || Number(user.coins) < 25000) {
        return res.status(400).json({ success: false, error: 'Minimum requirement: 25,000 Coins in balance to withdraw!' });
      }

      if (Number(user.atf_balance || 0) < withdrawAmount) {
        return res.status(400).json({ success: false, error: 'Insufficient ATF token balance!' });
      }

      let targetWallet = wallet_address || user.wallet_address;
      if (!targetWallet) {
        return res.status(400).json({ success: false, error: 'No wallet address bound. Please connect your wallet first!' });
      }

      // Potong saldo ATF user
      await supabase.from('users').update({
        atf_balance: Number(user.atf_balance) - withdrawAmount,
        updated_at: now
      }).eq('id', userIdStr);

      await supabase.from('transactions').insert([{
        user_id: userIdStr,
        type: 'WITHDRAW',
        amount: -withdrawAmount,
        description: `Withdrew ${withdrawAmount} ATF to ${targetWallet.slice(0, 6)}...`,
        created_at: now
      }]);

      return res.status(200).json({ success: true, message: `Successfully requested withdrawal of ${withdrawAmount} ATF!` });
    }

    return res.status(400).json({ success: false, error: 'Invalid market action endpoint.' });

  } catch (err) {
    return res.status(500).json({ success: false, error: 'Server error: ' + err.message });
  }
}
