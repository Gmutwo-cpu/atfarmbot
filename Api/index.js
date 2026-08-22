const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const BASE_GROW_TIME_MS = 13200000; // 3 Jam 40 Menit

// 1. INIT USER & PLOTS
app.post('/api/user/init', async (req, res) => {
  const { telegram_id, username } = req.body;
  if (!telegram_id) return res.status(400).json({ error: 'Missing telegram_id' });

  try {
    let { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();

    if (!user) {
      const { data: newUser, error: createError } = await supabase.from('users').insert([{
        telegram_id,
        username: username || 'Farmer',
        coins: 100,
        atf_balance: 0.0000,
        water_inventory: 1,
        fertilizer_inventory: 1
      }]).select().single();

      if (createError) throw createError;
      user = newUser;
    }

    const { data: plots } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).order('plot_index', { ascending: true });

    return res.json({ success: true, user, plots });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. PLANT CROP
app.post('/api/farm/plant', async (req, res) => {
  const { telegram_id, plot_index } = req.body;

  try {
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    if (!user || user.coins < 10) return res.status(400).json({ error: 'Coins tidak cukup' });

    const harvestTime = new Date(Date.now() + BASE_GROW_TIME_MS).toISOString();

    await supabase.from('users').update({ coins: user.coins - 10 }).eq('telegram_id', telegram_id);
    await supabase.from('plots').update({ status: 'growing', harvest_time: harvestTime }).match({ telegram_id, plot_index });

    const { data: plots } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).order('plot_index', { ascending: true });

    return res.json({ success: true, plots });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. APPLY BOOST
app.post('/api/farm/boost', async (req, res) => {
  const { telegram_id, plot_index, boost_type } = req.body;

  try {
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    const { data: plot } = await supabase.from('plots').select('*').match({ telegram_id, plot_index }).single();

    if (!plot || plot.status !== 'growing' || !plot.harvest_time) {
      return res.status(400).json({ error: 'Plot tidak dalam kondisi tumbuh' });
    }

    let reductionMs = 0;
    if (boost_type === 'water') {
      if (user.water_inventory <= 0) return res.status(400).json({ error: 'Air habis' });
      reductionMs = BASE_GROW_TIME_MS * 0.20;
      await supabase.from('users').update({ water_inventory: user.water_inventory - 1 }).eq('telegram_id', telegram_id);
    } else if (boost_type === 'fertilizer') {
      if (user.fertilizer_inventory <= 0) return res.status(400).json({ error: 'Pupuk habis' });
      reductionMs = BASE_GROW_TIME_MS * 0.40;
      await supabase.from('users').update({ fertilizer_inventory: user.fertilizer_inventory - 1 }).eq('telegram_id', telegram_id);
    }

    const currentHarvestTime = new Date(plot.harvest_time).getTime();
    const newHarvestTime = new Date(currentHarvestTime - reductionMs).toISOString();

    await supabase.from('plots').update({ harvest_time: newHarvestTime }).match({ telegram_id, plot_index });

    return res.json({ success: true, harvest_time: newHarvestTime });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. HARVEST CROP
app.post('/api/farm/harvest', async (req, res) => {
  const { telegram_id, plot_index } = req.body;

  try {
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    await supabase.from('users').update({ coins: user.coins + 50 }).eq('telegram_id', telegram_id);
    await supabase.from('plots').update({ status: 'empty', harvest_time: null }).match({ telegram_id, plot_index });

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. UNLOCK PLOT
app.post('/api/farm/unlock', async (req, res) => {
  const { telegram_id, plot_index, method } = req.body;

  try {
    if (method === 'coins') {
      const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
      if (user.coins < 5000) return res.status(400).json({ error: 'Coins tidak cukup' });
      await supabase.from('users').update({ coins: user.coins - 5000 }).eq('telegram_id', telegram_id);
    }
    await supabase.from('plots').update({ status: 'empty' }).match({ telegram_id, plot_index });

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = app;
