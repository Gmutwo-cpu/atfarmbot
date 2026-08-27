const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { telegram_id, action } = req.body;
    let { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    if (!user) return res.status(404).json({ error: 'User not found' });

    let updateData = {};
    let detailsLog = '';

    if (action === 'buy_seed') {
      if ((user.coins || 0) < 10) return res.status(400).json({ error: 'Not enough coins!' });
      updateData = { coins: user.coins - 10, seed_inventory: (user.seed_inventory || 0) + 1 };
      detailsLog = 'Purchased 1x Crop Seed (-10 Coins)';
    } else if (action === 'buy_water') {
      if ((user.coins || 0) < 20) return res.status(400).json({ error: 'Not enough coins!' });
      updateData = { coins: user.coins - 20, water_inventory: (user.water_inventory || 0) + 1 };
      detailsLog = 'Purchased 1x Water Supply (-20 Coins)';
    } else if (action === 'buy_fertilizer') {
      if ((user.coins || 0) < 50) return res.status(400).json({ error: 'Not enough coins!' });
      updateData = { coins: user.coins - 50, fertilizer_inventory: (user.fertilizer_inventory || 0) + 1 };
      detailsLog = 'Purchased 1x Fertilizer (-50 Coins)';
    } else if (action === 'sell_fruit') {
      const fruits = user.fruit_inventory || 0;
      if (fruits <= 0) return res.status(400).json({ error: 'No harvested fruits to sell!' });
      const earnedCoins = fruits * 45;
      updateData = { fruit_inventory: 0, coins: (user.coins || 0) + earnedCoins };
      detailsLog = `Sold ${fruits} Fruits for +${earnedCoins} Coins`;
    } else if (action === 'exchange_atf') {
      const coins = user.coins || 0;
      if (coins < 500) return res.status(400).json({ error: 'Minimum 500 Coins required to exchange for 1 ATF!' });
      const atfGained = Math.floor(coins / 500);
      const remainingCoins = coins % 500;
      updateData = { coins: remainingCoins, atf_balance: parseFloat(user.atf_balance || 0) + atfGained };
      detailsLog = `Exchanged ${atfGained * 500} Coins for ${atfGained} ATF Token`;
    } else {
      return res.status(400).json({ error: 'Invalid market action' });
    }

    await supabase.from('users').update(updateData).eq('telegram_id', telegram_id);
    await supabase.from('market_history').insert([{ telegram_id, details: detailsLog }]);

    const { data: updatedUser } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    const { data: market_history } = await supabase.from('market_history').select('*').eq('telegram_id', telegram_id).order('created_at', { ascending: false }).limit(5);

    return res.status(200).json({ success: true, message: detailsLog, user: updatedUser, market_history });
  } catch (err) {
    return res.status(500).json({ error: 'Server Error: ' + err.message });
  }
};
