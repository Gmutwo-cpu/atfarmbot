import { supabase } from '../../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { user_id, action_type } = req.body;

    if (!user_id || !action_type) {
      return res.status(400).json({ success: false, message: 'Missing user_id or action_type!' });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user_id)
      .single();

    const { data: farm, error: farmError } = await supabase
      .from('farms')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (userError || farmError || !user || !farm) {
      return res.status(404).json({ success: false, message: 'User or Farm data not found!' });
    }

    if (action_type === 'SELL_FRUITS') {
      if (farm.fruits < 1) {
        return res.status(400).json({ success: false, message: 'No harvested fruits available to sell!' });
      }

      const earnedCoins = farm.fruits * 45; // 45 Coins per fruit

      await supabase.from('farms').update({ fruits: 0, updated_at: new Date() }).eq('user_id', user_id);
      await supabase.from('users').update({ coins: Number(user.coins) + earnedCoins, updated_at: new Date() }).eq('id', user_id);

      await supabase.from('transactions').insert([{
        user_id,
        type: 'SELL_FRUIT',
        amount: earnedCoins,
        currency_type: 'COINS',
        description: `Sold all fruits for ${earnedCoins} Coins`
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

      // === SISTEM PENGAMAN: DAILY POOL LIMIT ===
      // Hitung total ATF yang ditukar oleh seluruh user hari ini di tabel transactions
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

      const DAILY_GLOBAL_POOL_LIMIT = 50.0000; // Maksimal 50 ATF per hari untuk seluruh pemain
      if (totalTodayExchanged + 1.0000 > DAILY_GLOBAL_POOL_LIMIT) {
        return res.status(400).json({ 
          success: false, 
          message: 'Daily global ATF exchange pool is fully claimed for today! Please try again tomorrow.' 
        });
      }
      // ===========================================

      const newCoins = Number(user.coins) - requiredCoins;
      const newAtf = Number(user.atf_balance) + 1.0000;

      await supabase.from('users').update({ 
        coins: newCoins, 
        atf_balance: newAtf, 
        updated_at: new Date() 
      }).eq('id', user_id);

      await supabase.from('transactions').insert([{
        user_id,
        type: 'EXCHANGE_ATF',
        amount: 1.0000,
        currency_type: 'ATF',
        description: 'Exchanged 500 Coins for 1.0000 ATF Achievement'
      }]);

      return res.status(200).json({ 
        success: true, 
        message: 'Successfully exchanged 500 Coins for 1.0000 ATF Achievement! (Off-chain milestone recorded).' 
      });
    } 
    else {
      return res.status(400).json({ success: false, message: 'Invalid action type!' });
    }

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
  }
}
