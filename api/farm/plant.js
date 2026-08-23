const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { telegram_id, plot_index } = req.body;
    if (!telegram_id || plot_index === undefined) {
      return res.status(400).json({ error: "Invalid parameters: missing telegram_id or plot_index" });
    }

    // 1. Fetch User Data
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('coins')
      .eq('telegram_id', telegram_id)
      .single();

    if (userErr || !user) {
      return res.status(404).json({ error: "User not found in database. Please restart app." });
    }

    if (user.coins < 10) {
      return res.status(400).json({ error: "Not enough coins for seed! (Required: 10 Coins)" });
    }

    // 2. Calculate Harvest Time (3 Hours 40 Minutes = 13,200,000 ms)
    const harvestTime = new Date(Date.now() + 13200000).toISOString();

    // 3. Deduct Coins
    const { error: coinErr } = await supabase
      .from('users')
      .update({ coins: user.coins - 10 })
      .eq('telegram_id', telegram_id);

    if (coinErr) throw coinErr;
    
    // 4. Update Plot Status
    const { error: updateErr } = await supabase
      .from('plots')
      .update({ 
        status: 'growing', 
        harvest_time: harvestTime, 
        boosted_water: false, 
        boosted_fert: false 
      })
      .eq('telegram_id', telegram_id)
      .eq('plot_index', plot_index);

    if (updateErr) throw updateErr;

    return res.status(200).json({ success: true, harvestTime });
  } catch (err) {
    return res.status(500).json({ error: "Server Error: " + err.message });
  }
};
