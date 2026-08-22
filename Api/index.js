const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MAX_DAILY_HARVEST = 10; // Anti-Bot Stamina Cap

// FRUIT SEEDS CONFIGURATION
const CROPS = {
  apple: { name: 'Apple', seedCost: 10, reward: 50, growMs: 13200000 },    // 3h 40m
  orange: { name: 'Orange', seedCost: 30, reward: 100, growMs: 21600000 },  // 6h
  melon: { name: 'Melon', seedCost: 80, reward: 280, growMs: 43200000 }    // 12h
};

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
        fertilizer_inventory: 1,
        seed_apple: 1,
        seed_orange: 0,
        seed_melon: 0
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

// 2. BUY SEEDS FROM STORE
app.post('/api/market/buy-seed', async (req, res) => {
  const { telegram_id, crop_type } = req.body;
  const crop = CROPS[crop_type];
  if (!crop) return res.status(400).json({ error: 'Invalid seed type' });

  try {
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    if (!user || user.coins < crop.seedCost) return res.status(400).json({ error: 'Insufficient Coins to buy seeds!' });

    const seedColumn = `seed_${crop_type}`;
    const updates = {
      coins: user.coins - crop.seedCost,
      [seedColumn]: (user[seedColumn] || 0) + 1
    };

    await supabase.from('users').update(updates).eq('telegram_id', telegram_id);
    await logActivity(telegram_id, `Bought ${crop.name} Seed`, `-${crop.seedCost} Coins`);

    return res.json({ success: true, user_updates: updates });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. PLANT CROP
app.post('/api/farm/plant', async (req, res) => {
  const { telegram_id, plot_index, crop_type } = req.body;
  const crop = CROPS[crop_type];
  if (!crop) return res.status(400).json({ error: 'Invalid crop type' });

  try {
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    const seedColumn = `seed_${crop_type}`;

    if (!user || (user[seedColumn] || 0) <= 0) {
      return res.status(400).json({ error: `You don't have ${crop.name} seeds. Purchase in Store!` });
    }

    const harvestTime = new Date(Date.now() + crop.growMs).toISOString();

    await supabase.from('users').update({ [seedColumn]: user[seedColumn] - 1 }).eq('telegram_id', telegram_id);
    await supabase.from('plots').update({ 
      status: 'growing', 
      crop_type: crop_type, 
      harvest_time: harvestTime 
    }).match({ telegram_id, plot_index });

    await logActivity(telegram_id, `Planted ${crop.name}`, `-1 Seed`);
    return res.json({ success: true, crop_type, harvest_time: harvestTime });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. HARVEST CROP
app.post('/api/farm/harvest', async (req, res) => {
  const { telegram_id, plot_index } = req.body;

  try {
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    const { data: plot } = await supabase.from('plots').select('*').match({ telegram_id, plot_index }).single();

    if (!user || !plot || plot.status !== 'ready') return res.status(400).json({ error: 'Plot is not ready for harvest!' });

    const crop = CROPS[plot.crop_type || 'apple'];
    const todayStr = new Date().toISOString().split('T')[0];
    const isNewDay = user.last_harvest_date !== todayStr;
    const currentHarvestCount = isNewDay ? 0 : (user.daily_harvest_count || 0);

    if (currentHarvestCount >= MAX_DAILY_HARVEST) {
      return res.status(400).json({ error: 'Daily Harvest Stamina Exhausted! (Max 10x/day).' });
    }

    await supabase.from('users').update({
      coins: user.coins + crop.reward,
      daily_harvest_count: currentHarvestCount + 1,
      last_harvest_date: todayStr
    }).eq('telegram_id', telegram_id);

    await supabase.from('plots').update({ status: 'empty', crop_type: null, harvest_time: null }).match({ telegram_id, plot_index });

    await logActivity(telegram_id, `Harvested ${crop.name}`, `+${crop.reward} Coins`);
    return res.json({ 
      success: true, 
      reward: crop.reward,
      daily_harvest_count: currentHarvestCount + 1 
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. UNLOCK PLOT
app.post('/api/farm/unlock-plot', async (req, res) => {
  const { telegram_id, plot_index } = req.body;

  try {
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    const { data: plot } = await supabase.from('plots').select('*').match({ telegram_id, plot_index }).single();

    if (!plot || plot.status !== 'locked') return res.status(400).json({ error: 'Plot is already unlocked!' });
    if (user.coins < plot.unlock_cost_coins) return res.status(400).json({ error: `Requires ${plot.unlock_cost_coins} Coins to unlock this plot!` });

    await supabase.from('users').update({ coins: user.coins - plot.unlock_cost_coins }).eq('telegram_id', telegram_id);
    await supabase.from('plots').update({ status: 'empty' }).match({ telegram_id, plot_index });

    await logActivity(telegram_id, `Unlocked Plot #${plot_index + 1}`, `-${plot.unlock_cost_coins} Coins`);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6. APPLY BOOST
app.post('/api/farm/boost', async (req, res) => {
  const { telegram_id, plot_index, boost_type } = req.body;

  try {
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    const { data: plot } = await supabase.from('plots').select('*').match({ telegram_id, plot_index }).single();

    if (!plot || plot.status !== 'growing' || !plot.harvest_time) return res.status(400).json({ error: 'Plot not eligible for boost' });

    const crop = CROPS[plot.crop_type || 'apple'];
    let reductionMs = 0;

    if (boost_type === 'water') {
      if (user.water_inventory <= 0) return res.status(400).json({ error: 'Water Pack depleted' });
      reductionMs = crop.growMs * 0.20;
      await supabase.from('users').update({ water_inventory: user.water_inventory - 1 }).eq('telegram_id', telegram_id);
    } else if (boost_type === 'fertilizer') {
      if (user.fertilizer_inventory <= 0) return res.status(400).json({ error: 'Fertilizer Pack depleted' });
      reductionMs = crop.growMs * 0.40;
      await supabase.from('users').update({ fertilizer_inventory: user.fertilizer_inventory - 1 }).eq('telegram_id', telegram_id);
    }

    const currentHarvestTime = new Date(plot.harvest_time).getTime();
    const newHarvestTime = new Date(currentHarvestTime - reductionMs).toISOString();

    await supabase.from('plots').update({ harvest_time: newHarvestTime }).match({ telegram_id, plot_index });
    await logActivity(telegram_id, `Used ${boost_type}`, `-1 Item`);

    return res.json({ success: true, harvest_time: newHarvestTime });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 7. MYSTERY BOX & DEX CONVERT
app.post('/api/market/mystery-box', async (req, res) => {
  const { telegram_id } = req.body;
  try {
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    if (!user || user.coins < 500) return res.status(400).json({ error: 'Insufficient Coins (500 Coins required)' });

    const rand = Math.random() * 100;
    let reward = {};
    if (rand < 60) reward = { type: 'title', name: '🏷️ Title: "Novice Farmer"' };
    else if (rand < 80) reward = { type: 'water', name: '💧 1x Water Pack' };
    else if (rand < 90) reward = { type: 'fertilizer', name: '🧪 1x Fertilizer Pack' };
    else if (rand < 98) reward = { type: 'coins', name: '💰 Cashback 100 Coins' };
    else reward = { type: 'skin', name: '🎨 Cyber Farm Skin' };

    let updates = { coins: user.coins - 500 };
    if (reward.type === 'water') updates.water_inventory = (user.water_inventory || 0) + 1;
    if (reward.type === 'fertilizer') updates.fertilizer_inventory = (user.fertilizer_inventory || 0) + 1;
    if (reward.type === 'coins') updates.coins = updates.coins + 100;
    if (reward.type === 'title' || reward.type === 'skin') updates.equipped_title = reward.name;

    await supabase.from('users').update(updates).eq('telegram_id', telegram_id);
    await logActivity(telegram_id, 'Mystery Box', '-500 Coins');
    return res.json({ success: true, reward });
  } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/market/convert', async (req, res) => {
  const { telegram_id, coin_amount } = req.body;
  try {
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    if (!user || user.coins < coin_amount) return res.status(400).json({ error: 'Insufficient Coins' });

    const todayStr = new Date().toISOString().split('T')[0];
    const isNewDay = user.last_swap_date !== todayStr;
    const currentSwapped = isNewDay ? 0 : (user.daily_swapped_coins || 0);

    if (currentSwapped >= 10000) return res.status(400).json({ error: 'Daily Swap Limit (10,000 Coins) Reached!' });

    await supabase.from('users').update({
      coins: user.coins - coin_amount,
      atf_balance: parseFloat(user.atf_balance) + 1.0,
      daily_swapped_coins: currentSwapped + coin_amount,
      last_swap_date: todayStr
    }).eq('telegram_id', telegram_id);

    await logActivity(telegram_id, 'DEX Swap', '+1.0 ATF');
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

module.exports = app;
