const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const BASE_GROW_TIME_MS = 13200000;

async function logActivity(telegram_id, activity_name, amount) {
  try {
    await supabase.from('activity_logs').insert([{ telegram_id, activity_name, amount }]);
  } catch(e) { console.error("Log failed", e); }
}

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
    const { data: history } = await supabase.from('activity_logs').select('*').eq('telegram_id', telegram_id).order('created_at', { ascending: false }).limit(5);

    return res.json({ success: true, user, plots, history });
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

    await logActivity(telegram_id, 'Tanam Apel', '-10 Coins');
    return res.json({ success: true });
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
      return res.status(400).json({ error: 'Plot tidak valid' });
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
    await logActivity(telegram_id, `Pakai ${boost_type}`, `-1 ${boost_type}`);

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

    await logActivity(telegram_id, 'Panen Hasil Lahan', '+50 Coins');
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. MYSTERY BOX WITH PROPORTIONAL DROP RATE (COIN SINK)
app.post('/api/market/mystery-box', async (req, res) => {
  const { telegram_id } = req.body;

  try {
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    if (!user || user.coins < 500) return res.status(400).json({ error: 'Coins tidak cukup (500 Coins)' });

    // Weight Gacha Drop Rate
    const rand = Math.random() * 100;
    let reward = {};

    if (rand < 60) {
      // 60% Common Title
      reward = { type: 'title', name: '🏷️ Title: "Novice Farmer"' };
    } else if (rand < 80) {
      // 20% Water Booster
      reward = { type: 'water', name: '💧 1x Water Pack' };
    } else if (rand < 90) {
      // 10% Fertilizer Booster
      reward = { type: 'fertilizer', name: '🧪 1x Fertilizer Pack' };
    } else if (rand < 98) {
      // 8% Cashback
      reward = { type: 'coins', name: '💰 Cashback 100 Coins' };
    } else {
      // 2% Rare Skin
      reward = { type: 'skin', name: '🎨 Rare Cyber-Farm Theme' };
    }

    let updates = { coins: user.coins - 500 };
    if (reward.type === 'water') updates.water_inventory = user.water_inventory + 1;
    if (reward.type === 'fertilizer') updates.fertilizer_inventory = user.fertilizer_inventory + 1;
    if (reward.type === 'coins') updates.coins = updates.coins + 100;
    if (reward.type === 'title' || reward.type === 'skin') {
      updates.equipped_title = reward.name;
    }

    await supabase.from('users').update(updates).eq('telegram_id', telegram_id);
    await logActivity(telegram_id, 'Buka Mystery Box', '-500 Coins');

    return res.json({ success: true, reward });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6. DYNAMIC CONVERT / SWAP (WITH DAILY CAP)
app.post('/api/market/convert', async (req, res) => {
  const { telegram_id, coin_amount } = req.body;

  try {
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    if (!user || user.coins < coin_amount) return res.status(400).json({ error: 'Coins tidak cukup' });

    const todayStr = new Date().toISOString().split('T')[0];
    if (user.last_swap_date === todayStr && user.daily_swapped_coins >= 10000) {
      return res.status(400).json({ error: 'Batas Swap Harian Tercapai (Maks 10,000 Coins / Hari)' });
    }

    const currentSwapped = (user.last_swap_date === todayStr) ? user.daily_swapped_coins : 0;
    const newSwappedTotal = currentSwapped + coin_amount;

    await supabase.from('users').update({
      coins: user.coins - coin_amount,
      atf_balance: parseFloat(user.atf_balance) + 1.0,
      daily_swapped_coins: newSwappedTotal,
      last_swap_date: todayStr
    }).eq('telegram_id', telegram_id);

    await logActivity(telegram_id, 'Swap DEX Coins->ATF', '+1.0 ATF');

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = app;
