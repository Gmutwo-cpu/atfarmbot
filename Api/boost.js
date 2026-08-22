const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CROPS = {
  apple: { name: 'Apple', growMs: 13200000 },
  orange: { name: 'Orange', growMs: 21600000 },
  melon: { name: 'Melon', growMs: 43200000 }
};

async function logActivity(telegram_id, activity_name, amount) {
  try {
    await supabase.from('activity_logs').insert([{ telegram_id, activity_name, amount }]);
  } catch(e) {}
}

module.exports = async (req, res) => {
  // Set header agar selalu mengembalikan JSON
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { telegram_id, plot_index, boost_type } = req.body;

  try {
    const { data: user, error: userErr } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    if (userErr || !user) return res.status(400).json({ success: false, error: 'User not found!' });

    const { data: plot, error: plotErr } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).eq('plot_index', plot_index).single();
    if (plotErr || !plot) return res.status(400).json({ success: false, error: 'Plot not found!' });

    if (plot.status !== 'growing' || !plot.harvest_time) {
      return res.status(400).json({ success: false, error: 'Plot is not currently growing!' });
    }

    const crop = CROPS[plot.crop_type || 'apple'];
    let reductionMs = 0;
    let updatePlot = {};
    let updateUserData = {};

    if (boost_type === 'water') {
      if (plot.boosted_water) return res.status(400).json({ success: false, error: 'Water Boost already applied!' });
      if ((user.water_inventory || 0) <= 0) return res.status(400).json({ success: false, error: 'No Water Pack in inventory!' });
      
      reductionMs = crop.growMs * 0.20;
      updatePlot.boosted_water = true;
      updateUserData.water_inventory = Math.max(0, (user.water_inventory || 0) - 1);
    } else if (boost_type === 'fertilizer') {
      if (plot.boosted_fert) return res.status(400).json({ success: false, error: 'Fertilizer Boost already applied!' });
      if ((user.fertilizer_inventory || 0) <= 0) return res.status(400).json({ success: false, error: 'No Fertilizer Pack in inventory!' });
      
      reductionMs = crop.growMs * 0.40;
      updatePlot.boosted_fert = true;
      updateUserData.fertilizer_inventory = Math.max(0, (user.fertilizer_inventory || 0) - 1);
    } else {
      return res.status(400).json({ success: false, error: 'Invalid boost type!' });
    }

    const currentHarvestMs = new Date(plot.harvest_time).getTime();
    const nowMs = Date.now();
    const newHarvestMs = Math.max(nowMs, currentHarvestMs - reductionMs);
    const newHarvestTimeISO = new Date(newHarvestMs).toISOString();

    updatePlot.harvest_time = newHarvestTimeISO;
    if (newHarvestMs <= nowMs) {
      updatePlot.status = 'ready';
    }

    await supabase.from('users').update(updateUserData).eq('telegram_id', telegram_id);
    await supabase.from('plots').update(updatePlot).eq('telegram_id', telegram_id).eq('plot_index', plot_index);
    await logActivity(telegram_id, `Used ${boost_type.toUpperCase()}`, `-1 Item`);

    return res.status(200).json({ 
      success: true, 
      harvest_time: newHarvestTimeISO,
      status: updatePlot.status || 'growing',
      user_updates: updateUserData
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
};