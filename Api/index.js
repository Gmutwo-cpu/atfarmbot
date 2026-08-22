const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MAX_DAILY_HARVEST = 10;
const MAX_DAILY_WATER_BUY = 3;
const MAX_DAILY_FERT_BUY = 2;

const CROPS = {
  apple: { name: 'Apple', seedCost: 10, reward: 50, growMs: 13200000 },    // 3h 40m
  orange: { name: 'Orange', seedCost: 30, reward: 100, growMs: 21600000 },  // 6h
  melon: { name: 'Melon', seedCost: 80, reward: 280, growMs: 43200000 }    // 12h
};

const BOOST_PRICES = {
  water: 15,
  fertilizer: 35
};

async function logActivity(telegram_id, activity_name, amount) {
  try {
    await supabase.from('activity_logs').insert([{ telegram_id, activity_name, amount }]);
  } catch(e) { console.error("Log failed", e); }
}

// 1. INIT USER
app.post('/api/user/init', async (req, res) => {
  const { telegram_id, username } = req.body;
  if (!telegram_id) return res.status(400).json({ success: false, error: 'Missing telegram_id' });

  try {
    let { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).maybeSingle();

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
    const { data: notice } = await supabase.from('system_notices').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle();

    return res.json({ success: true, user, plots, history, notice: notice || null });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. BUY SEED
app.post('/api/market/buy-seed', async (req, res) => {
  const { telegram_id, crop_type } = req.body;
  const crop = CROPS[crop_type];
  if (!crop) return res.status(400).json({ success: false, error: 'Invalid seed type' });

  try {
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    if (!user || user.coins < crop.seedCost) return res.status(400).json({ success: false, error: 'Insufficient Coins!' });

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

// 3. BUY BOOST ITEM
app.post('/api/market/buy-boost', async (req, res) => {
  const { telegram_id, item_type } = req.body;
  const price = BOOST_PRICES[item_type];
  if (!price) return res.status(400).json({ success: false, error: 'Invalid boost item type' });

  try {
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    if (!user || user.coins < price) return res.status(400).json({ success: false, error: 'Insufficient Coins!' });

    const todayStr = new Date().toISOString().split('T')[0];
    const isNewDay = user.last_boost_buy_date !== todayStr;
    
    let waterBought = isNewDay ? 0 : (user.daily_water_bought || 0);
    let fertBought = isNewDay ? 0 : (user.daily_fert_bought || 0);

    let updates = { coins: user.coins - price, last_boost_buy_date: todayStr };

    if (item_type === 'water') {
      if (waterBought >= MAX_DAILY_WATER_BUY) return res.status(400).json({ success: false, error: 'Daily Water Purchase Limit Reached (Max 3/day)!' });
      updates.water_inventory = (user.water_inventory || 0) + 1;
      updates.daily_water_bought = waterBought + 1;
    } else if (item_type === 'fertilizer') {
      if (fertBought >= MAX_DAILY_FERT_BUY) return res.status(400).json({ success: false, error: 'Daily Fertilizer Purchase Limit Reached (Max 2/day)!' });
      updates.fertilizer_inventory = (user.fertilizer_inventory || 0) + 1;
      updates.daily_fert_bought = fertBought + 1;
    }

    await supabase.from('users').update(updates).eq('telegram_id', telegram_id);
    await logActivity(telegram_id, `Bought ${item_type.toUpperCase()} Pack`, `-${price} Coins`);

    return res.json({ success: true, user_updates: updates });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. PLANT CROP
app.post('/api/farm/plant', async (req, res) => {
  const { telegram_id, plot_index, crop_type } = req.body;
  const crop = CROPS[crop_type];
  if (!crop) return res.status(400).json({ success: false, error: 'Invalid crop type' });

  try {
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    const seedColumn = `seed_${crop_type}`;

    if (!user || (user[seedColumn] || 0) <= 0) {
      return res.status(400).json({ success: false, error: `No ${crop.name} seeds in inventory.` });
    }

    const harvestTime = new Date(Date.now() + crop.growMs).toISOString();

    await supabase.from('users').update({ [seedColumn]: user[seedColumn] - 1 }).eq('telegram_id', telegram_id);
    await supabase.from('plots').update({ 
      status: 'growing', 
      crop_type: crop_type, 
      harvest_time: harvestTime,
      boosted_water: false,
      boosted_fert: false
    }).eq('telegram_id', telegram_id).eq('plot_index', plot_index);

    await logActivity(telegram_id, `Planted ${crop.name}`, `-1 Seed`);
    return res.json({ success: true, crop_type, harvest_time: harvestTime });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. APPLY BOOST (BOOSTER LOGIC)
app.post('/api/farm/boost', async (req, res) => {
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
    if (!crop) return res.status(400).json({ success: false, error: 'Invalid crop state!' });

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

    const { error: uUpErr } = await supabase.from('users').update(updateUserData).eq('telegram_id', telegram_id);
    if (uUpErr) throw uUpErr;

    const { error: pUpErr } = await supabase.from('plots').update(updatePlot).eq('telegram_id', telegram_id).eq('plot_index', plot_index);
    if (pUpErr) throw pUpErr;

    await logActivity(telegram_id, `Used ${boost_type.toUpperCase()}`, `-1 Item`);

    return res.json({ 
      success: true, 
      harvest_time: newHarvestTimeISO,
      status: updatePlot.status || 'growing',
      user_updates: updateUserData
    });
  } catch (err) {
    console.error("Boost Error:", err);
    return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
});

// 6. HARVEST CROP
app.post('/api/farm/harvest', async (req, res) => {
  const { telegram_id, plot_index } = req.body;

  try {
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    const { data: plot } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).eq('plot_index', plot_index).single();

    if (!user || !plot || plot.status !== 'ready') return res.status(400).json({ success: false, error: 'Plot not ready for harvest!' });

    const crop = CROPS[plot.crop_type || 'apple'];
    const todayStr = new Date().toISOString().split('T')[0];
    const isNewDay = user.last_harvest_date !== todayStr;
    const currentHarvestCount = isNewDay ? 0 : (user.daily_harvest_count || 0);

    if (currentHarvestCount >= MAX_DAILY_HARVEST) {
      return res.status(400).json({ success: false, error: 'Daily Stamina Exhausted! (Max 10x/day)' });
    }

    await supabase.from('users').update({
      coins: user.coins + crop.reward,
      daily_harvest_count: currentHarvestCount + 1,
      last_harvest_date: todayStr
    }).eq('telegram_id', telegram_id);

    await supabase.from('plots').update({ status: 'empty', crop_type: null, harvest_time: null, boosted_water: false, boosted_fert: false }).eq('telegram_id', telegram_id).eq('plot_index', plot_index);

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

// 7. UNLOCK PLOT
app.post('/api/farm/unlock-plot', async (req, res) => {
  const { telegram_id, plot_index } = req.body;

  try {
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    const { data: plot } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).eq('plot_index', plot_index).single();

    if (!plot || plot.status !== 'locked') return res.status(400).json({ success: false, error: 'Plot already unlocked!' });
    if (user.coins < plot.unlock_cost_coins) return res.status(400).json({ success: false, error: `Requires ${plot.unlock_cost_coins} Coins to unlock!` });

    await supabase.from('users').update({ coins: user.coins - plot.unlock_cost_coins }).eq('telegram_id', telegram_id);
    await supabase.from('plots').update({ status: 'empty' }).eq('telegram_id', telegram_id).eq('plot_index', plot_index);

    await logActivity(telegram_id, `Unlocked Plot #${plot_index + 1}`, `-${plot.unlock_cost_coins} Coins`);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = app;
