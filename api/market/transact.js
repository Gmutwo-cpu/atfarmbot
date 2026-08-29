import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { user_id, action_type } = req.body; // 'SELL_FRUITS' or 'EXCHANGE_ATF'

    const { data: user } = await supabase.from('users').select('*').eq('id', user_id).single();
    const { data: farm } = await supabase.from('farms').select('*').eq('user_id', user_id).single();

    if (action_type === 'SELL_FRUITS') {
      if (farm.fruits < 1) return res.status(400).json({ success: false, message: 'No fruits available to sell!' });
      
      const earnedCoins = farm.fruits * 45; // 45 Coins per fruit
      await supabase.from('farms').update({ fruits: 0 }).eq('user_id', user_id);
      await supabase.from('users').update({ coins: user.coins + earnedCoins }).eq('id', user_id);

      await supabase.from('transactions').insert([{
        user_id, type: 'SELL_FRUIT', amount: earnedCoins, currency_type: 'COINS', description: `Sold harvested fruits for ${earnedCoins} coins`
      }]);

      return res.status(200).json({ success: true, message: `Successfully sold fruits for +${earnedCoins} Coins!` });
    } 
    
    if (action_type === 'EXCHANGE_ATF') {
      const requiredCoins = 500;
      if (user.coins < requiredCoins) return res.status(400).json({ success: false, message: 'Need at least 500 Coins to exchange for 1 ATF Token!' });

      await supabase.from('users').update({
        coins: user.coins - requiredCoins,
        atf_balance: Number(user.atf_balance) + 1.0000
      }).eq('id', user_id);

      await supabase.from('transactions').insert([{
        user_id, type: 'EXCHANGE_ATF', amount: 1.0000, currency_type: 'ATF', description: 'Exchanged 500 Coins for 1.0000 ATF Token'
      }]);

      return res.status(200).json({ success: true, message: 'Successfully exchanged 500 Coins for 1.0000 ATF Token!' });
    }

    return res.status(400).json({ success: false, message: 'Invalid action type!' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
