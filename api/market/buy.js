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
    if (!telegram_id || !action) return res.status(400).json({ error: "Missing required parameters" });

    let { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    if (!user) return res.status(404).json({ error: "User not found" });

    let updateData = {};
    let message = "";

    if (action === 'buy_seed') {
      if (user.coins < 10) return res.status(400).json({ error: "Not enough coins!" });
      updateData = { coins: user.coins - 10, seed_inventory: (user.seed_inventory || 0) + 1 };
      message = "Successfully purchased 1x Crop Seed!";
    } else if (action === 'buy_water') {
      if (user.coins < 20) return res.status(400).json({ error: "Not enough coins!" });
      updateData = { coins: user.coins - 20, water_inventory: (user.water_inventory || 0) + 1 };
      message = "Successfully purchased 1x Water Supply!";
    } else if (action === 'buy_fertilizer') {
      if (user.coins < 50) return res.status(400).json({ error: "Not enough coins!" });
      updateData = { coins: user.coins - 50, fertilizer_inventory: (user.fertilizer_inventory || 0) + 1 };
      message = "Successfully purchased 1x Fertilizer!";
    } else if (action === 'sell_fruit') {
      const fruits = user.fruit_inventory || 0;
      if (fruits <= 0) return res.status(400).json({ error: "No fruits available to sell!" });
      const earned = fruits * 45;
      updateData = { fruit_inventory: 0, coins: user.coins + earned };
      message = `Successfully sold fruits for ${earned} coins!`;
    } else if (action === 'exchange_atf') {
      if (user.coins < 500) return res.status(400).json({ error: "Not enough coins! Need 500 coins for 1 ATF." });
      updateData = { coins: user.coins - 500, atf_balance: parseFloat(user.atf_balance || 0) + 1.0000 };
      message = "Successfully exchanged 500 Coins for 1.0000 ATF!";
    } else {
      return res.status(400).json({ error: "Invalid market action" });
    }

    await supabase.from('users').update(updateData).eq('telegram_id', telegram_id);
    
    await supabase.from('market_history').insert([{ telegram_id, action_type: action, details: message }]);

    const { data: updatedUser } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    const { data: plots } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).order('plot_index');
    const { data: market_history } = await supabase.from('market_history').select('*').eq('telegram_id', telegram_id).order('created_at', { ascending: false }).limit(5);

    return res.status(200).json({ success: true, message, user: updatedUser, plots, market_history });
  } catch (err) {
    return res.status(500).json({ error: "Server Error: " + err.message });
  }
};
