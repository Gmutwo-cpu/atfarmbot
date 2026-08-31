import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const { action, user_id, item_type, action_type, amount, wallet_address } = req.body;

  if (!user_id) {
    return res.status(400).json({ success: false, message: 'Missing user_id!' });
  }

  const userIdStr = String(user_id);
  const now = new Date();

  try {
    // 1. ACTION: BUY SUPPLIES (SEED, WATER, FERTILIZER)
    if (action === 'buy_item' || action_type === 'BUY_ITEM') {
      const prices = { SEED: 10, WATER: 20, FERTILIZER: 50 };
      const cost = prices[item_type];

      if (!cost) {
        return res.status(400).json({ success: false, message: 'Invalid item type selected!' });
      }

      let { data: user, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', userIdStr)
        .single();

      if (userError || !user) {
        return res.status(404).json({ success: false, message: 'User not found!' });
      }

      if (Number(user.coins) < cost) {
        return res.status(400).json({ success: false, message: 'Insufficient Coins! Complete tasks or sell fruits.' });
      }

      let { data: farm, error: farmError } = await supabase
        .from('user_farms')
        .select('*')
        .eq('user_id', userIdStr)
        .single();

      if (farmError || !farm) {
        return res.status(404).json({ success: false, message: 'Farm data not found!' });
      }

      await supabase
        .from('users')
        .update({ coins: Number(user.coins) - cost, updated_at: now })
        .eq('id', userIdStr);

      let updateData = { updated_at: now };
      if (item_type === 'SEED') updateData.seeds = (farm.seeds || 0) + 1;
      if (item_type === 'WATER') updateData.water = (farm.water || 0) + 1;
      if (item_type === 'FERTILIZER') updateData.fertilizer = (farm.fertilizer || 0) + 1;

      await supabase
        .from('user_farms')
        .update(updateData)
        .eq('user_id', userIdStr);

      await supabase.from('transactions').insert([{
        user_id: userIdStr,
        type: `BUY_${item_type}`,
        amount: cost,
        currency_type: 'COINS',
        description: `Purchased 1x ${item_type} for ${cost} coins`,
        created_at: now
      }]);

      return res.status(200).json({ 
        success: true, 
        message: `Successfully purchased 1x ${item_type}!` 
      });
    }

    // 2. ACTION: TRANSACT MARKET (SELL FRUITS / EXCHANGE ATF)
    if (action === 'transact' || action_type === 'SELL_FRUITS' || action_type === 'EXCHANGE_ATF') {
      let { data: user, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', userIdStr)
        .single();

      let { data: farm, error: farmError } = await supabase
        .from('user_farms')
        .select('*')
        .eq('user_id', userIdStr)
        .single();

      if (userError || farmError || !user || !farm) {
        return res.status(404).json({ success: false, message: 'User or Farm data not found!' });
      }

      if (action_type === 'SELL_FRUITS') {
        if (farm.fruits < 1) {
          return res.status(400).json({ success: false, message: 'No harvested fruits available to sell!' });
        }

        const earnedCoins = farm.fruits * 45;

        await supabase.from('user_farms').update({ fruits: 0, updated_at: now }).eq('user_id', userIdStr);
        await supabase.from('users').update({ coins: Number(user.coins) + earnedCoins, updated_at: now }).eq('id', userIdStr);

        await supabase.from('transactions').insert([{
          user_id: userIdStr,
          type: 'SELL_FRUIT',
          amount: earnedCoins,
          currency_type: 'COINS',
          description: `Sold all fruits for ${earnedCoins} Coins`,
          created_at: now
        }]);

        return res.status(200).json({ 
          success: true, 
          message: `Successfully sold all fruits for +${earnedCoins} Coins!` 
        });
      } 
      else if (action_type === 'EXCHANGE_ATF') {
        const requiredCoins = 500;
        if (Number(user.coins) < requiredCoins) {
          return res.status(400).json({ success: false, message: 'Need at least 500 Coins to exchange for 1.0000 ATF Achievement!' });
        }

        // Daily Pool Limit Check
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const { data: todayTxs } = await supabase
          .from('transactions')
          .select('amount')
          .eq('type', 'EXCHANGE_ATF')
          .gte('created_at', todayStart.toISOString());

        let totalTodayExchanged = 0;
        if (todayTxs) {
          totalTodayExchanged = todayTxs.reduce((sum, tx) => sum + Number(tx.amount), 0);
        }

        const DAILY_GLOBAL_POOL_LIMIT = 50.0000;
        if (totalTodayExchanged + 1.0000 > DAILY_GLOBAL_POOL_LIMIT) {
          return res.status(400).json({ 
            success: false, 
            message: 'Daily global ATF exchange pool is fully claimed for today! Please try again tomorrow.' 
          });
        }

        const newCoins = Number(user.coins) - requiredCoins;
        const newAtf = Number(user.atf_balance || 0) + 1.0000;

        await supabase.from('users').update({ 
          coins: newCoins, 
          atf_balance: newAtf, 
          updated_at: now 
        }).eq('id', userIdStr);

        await supabase.from('transactions').insert([{
          user_id: userIdStr,
          type: 'EXCHANGE_ATF',
          amount: 1.0000,
          currency_type: 'ATF',
          description: 'Exchanged 500 Coins for 1.0000 ATF Achievement',
          created_at: now
        }]);

        return res.status(200).json({ 
          success: true, 
          message: 'Successfully exchanged 500 Coins for 1.0000 ATF Achievement! (Off-chain milestone recorded).' 
        });
      }
    }

    // 3. ACTION: FETCH TRANSACTION HISTORY
    if (action === 'history') {
      const { data: txs, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userIdStr)
        .order('created_at', { ascending: false })
        .limit(15);

      if (error) throw error;
      return res.status(200).json({ success: true, history: txs || [] });
    }

    // 4. ACTION: WITHDRAW ATF TOKENS
    if (action === 'withdraw') {
      const withdrawAmount = Number(amount);

      if (!withdrawAmount || withdrawAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid withdrawal parameters!' });
      }

      if (withdrawAmount > 500) {
        return res.status(400).json({ success: false, message: 'Max withdrawal limit is 500 ATF per day!' });
      }

      let { data: user, error: userErr } = await supabase
        .from('users')
        .select('*')
        .eq('id', userIdStr)
        .single();

      if (userErr || !user) {
        return res.status(404).json({ success: false, message: 'User not found!' });
      }

      const currentCoins = Number(user.coins || 0);
      if (currentCoins < 25000) {
        return res.status(400).json({ 
          success: false, 
          message: `Insufficient Coins! You need at least 25,000 Coins to withdraw ATF (Current: ${currentCoins.toLocaleString()}).` 
        });
      }

      const currentAtf = Number(user.atf_balance || 0);
      if (currentAtf < withdrawAmount) {
        return res.status(400).json({ success: false, message: 'Insufficient ATF balance for withdrawal!' });
      }

      const targetWallet = wallet_address || user.wallet_address;
      if (!targetWallet) {
        return res.status(400).json({ success: false, message: 'No wallet address bound. Please connect your wallet first!' });
      }

      let newAtfBalance = currentAtf - withdrawAmount;
      let { error: updateErr } = await supabase
        .from('users')
        .update({ atf_balance: newAtfBalance, updated_at: now })
        .eq('id', userIdStr);

      if (updateErr) {
        throw new Error('Failed to process withdrawal balance update.');
      }

      await supabase.from('transactions').insert([
        {
          user_id: userIdStr,
          type: 'WITHDRAW_ATF',
          amount: withdrawAmount,
          currency_type: 'ATF',
          description: `Successfully withdrew ${withdrawAmount.toFixed(4)} ATF tokens to ${targetWallet.slice(0, 6)}...`,
          created_at: now
        }
      ]);

      return res.status(200).json({
        success: true,
        message: `Withdrawal successful! ${withdrawAmount.toFixed(4)} ATF sent to your external wallet.`,
        new_atf: newAtfBalance
      });
    }

    return res.status(400).json({ success: false, message: 'Invalid market action endpoint.' });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Exception: ' + err.message });
  }
}
