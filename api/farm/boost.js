const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { telegram_id, plot_index, boost_type } = req.body;
    if (!telegram_id || plot_index === undefined || !boost_type) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    const { data: plot } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).eq('plot_index', plot_index).single();

    if (!user || !plot) return res.status(404).json({ error: 'User or Plot not found' });
    if (plot.status !== 'growing') return res.status(400).json({ error: 'Plot is not currently growing' });

    let currentHarvestTime = new Date(plot.harvest_time).getTime();
    let now = Date.now();
    let remainingTime = currentHarvestTime - now;

    if (remainingTime <= 0) {
      return res.status(400).json({ error: 'Crop is already ready for harvest!' });
    }

    let updateFields = {};

    if (boost_type === 'water') {
      if (plot.boosted_water) return res.status(400).json({ error: 'Water booster already applied to this plot!' });
      if (user.water_inventory < 1) return res.status(400).json({ error: 'Insufficient Water inventory! Please buy more in Market.' });

      let reducedTime = remainingTime * 0.80; // Mengurangi 20% dari sisa waktu
      updateFields.harvest_time = new Date(now + reducedTime).toISOString();
      updateFields.boosted_water = true;

      await supabase.from('users').update({ water_inventory: user.water_inventory - 1 }).eq('telegram_id', telegram_id);

    } else if (boost_type === 'fertilizer') {
      if (plot.boosted_fert) return res.status(400).json({ error: 'Fertilizer booster already applied to this plot!' });
      if (user.fertilizer_inventory < 1) return res.status(400).json({ error: 'Insufficient Fertilizer inventory! Please buy more in Market.' });

      let reducedTime = remainingTime * 0.60; // Mengurangi 40% dari sisa waktu
      updateFields.harvest_time = new Date(now + reducedTime).toISOString();
      updateFields.boosted_fert = true;

      await supabase.from('users').update({ fertilizer_inventory: user.fertilizer_inventory - 1 }).eq('telegram_id', telegram_id);
    } else {
      return res.status(400).json({ error: 'Invalid boost type' });
    }

    await supabase.from('plots').update(updateFields).eq('telegram_id', telegram_id).eq('plot_index', plot_index);

    return res.json({ success: true, message: `${boost_type} booster applied successfully!` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
