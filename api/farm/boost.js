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
    const { telegram_id, plot_index, boost_type } = req.body;
    if (!telegram_id || plot_index === undefined || !boost_type) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // 1. Get user data for inventory check
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

    if (plot.status !== 'growing') {
      return res.status(400).json({ error: "Plot is not in growing state" });
    }

    let reductionSeconds = 0;
    let updateInventory = {};

    if (boost_type === 'water') {
      if (user.water_inventory <= 0) return res.status(400).json({ error: "No water inventory left!" });
      if (plot.boosted_water) return res.status(400).json({ error: "Water booster already used on this plot!" });
      
      reductionSeconds = 30 * 60; // Kurangi 30 menit
      updateInventory = { water_inventory: user.water_inventory - 1 };
    } else if (boost_type === 'fertilizer') {
      if (user.fertilizer_inventory <= 0) return res.status(400).json({ error: "No fertilizer inventory left!" });
      if (plot.boosted_fert) return res.status(400).json({ error: "Fertilizer booster already used on this plot!" });
      
      reductionSeconds = 60 * 60; // Kurangi 60 menit
      updateInventory = { fertilizer_inventory: user.fertilizer_inventory - 1 };
    } else {
      return res.status(400).json({ error: "Invalid boost type" });
    }

    // 3. Update user inventory
    const { error: invErr } = await supabase
      .from('users')
      .update(updateInventory)
      .eq('telegram_id', telegram_id);

    if (invErr) throw invErr;

    // 4. Calculate new harvest time
    const currentHarvestTime = new Date(plot.harvest_time).getTime();
    const newHarvestTime = new Date(Math.max(Date.now(), currentHarvestTime - (reductionSeconds * 1000))).toISOString();

    const boostField = boost_type === 'water' ? { boosted_water: true } : { boosted_fert: true };

    const { error: plotUpdateErr } = await supabase
      .from('plots')
      .update({ harvest_time: newHarvestTime, ...boostField })
      .eq('telegram_id', telegram_id)
      .eq('plot_index', plot_index);

    if (plotUpdateErr) throw plotUpdateErr;

    return res.status(200).json({ success: true, message: "Booster applied successfully!" });

  } catch (err) {
    return res.status(500).json({ error: "Server Error: " + err.message });
  }
};
