const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
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
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // 1. Get user data
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegram_id)
      .single();

    if (userErr || !user) {
      return res.status(404).json({ error: "User not found in database" });
    }

    // 2. Get specific plot
    const { data: plot, error: plotErr } = await supabase
      .from('plots')
      .select('*')
      .eq('telegram_id', telegram_id)
      .eq('plot_index', plot_index)
      .single();

    if (plotErr || !plot) {
      return res.status(404).json({ error: "Plot not found" });
    }

    if (plot.status !== 'ready') {
      return res.status(400).json({ error: "Crop is not ready for harvest yet" });
    }

    // 3. Reward user coins (e.g., +50 coins per harvest) and reset plot to 'empty'
    const HARVEST_REWARD = 50;

    const { error: updateCoinErr } = await supabase
      .from('users')
      .update({ coins: user.coins + HARVEST_REWARD })
      .eq('telegram_id', telegram_id);

    if (updateCoinErr) throw updateCoinErr;

    const { error: updatePlotErr } = await supabase
      .from('plots')
      .update({ status: 'empty', harvest_time: null, boosted_water: false, boosted_fert: false })
      .eq('telegram_id', telegram_id)
      .eq('plot_index', plot_index);

    if (updatePlotErr) throw updatePlotErr;

    return res.status(200).json({ success: true, message: "Harvested successfully!" });

  } catch (err) {
    return res.status(500).json({ error: "Server Error: " + err.message });
  }
};