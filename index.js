const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// 1. INIT USER & SYNC STATE (Safe Fallback for Plots)
app.post('/api/user/init', async (req, res) => {
  try {
    const { telegram_id, username } = req.body;
    if (!telegram_id) return res.status(400).json({ error: "Missing telegram_id" });

    let { data: user, error: userErr } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();

    if (!user) {
      const { data: newUser, error: insErr } = await supabase.from('users').insert([{
        telegram_id,
        username: username || 'Farmer',
        coins: 150,
        atf_balance: 0.0000,
        water_inventory: 2,
        fertilizer_inventory: 1
      }]).select().single();
      
      if (insErr) throw insErr;
      user = newUser;
    }

    let { data: plots, error: plotErr } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).order('plot_index', { ascending: true });
    
    if (!plots || plots.length === 0) {
      const defaultPlots = [
        { telegram_id, plot_index: 0, status: 'empty' },
        { telegram_id, plot_index: 1, status: 'locked' },
        { telegram_id, plot_index: 2, status: 'locked' },
        { telegram_id, plot_index: 3, status: 'locked' }
      ];
      await supabase.from('plots').insert(defaultPlots);
      const { data: newPlots } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).order('plot_index', { ascending: true });
      plots = newPlots;
    }

    const { data: tasks } = await supabase.from('completed_tasks').select('task_code').eq('telegram_id', telegram_id);
    const { data: history } = await supabase.from('market_history').select('*').eq('telegram_id', telegram_id).order('created_at', { ascending: false }).limit(10);

    return res.json({ success: true, user, plots: plots || [], completed_tasks: tasks || [], history: history || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 2. PLANT SEED (Duration: 3 Hours 40 Minutes = 13,200,000 ms)
app.post('/api/farm/plant', async (req, res) => {
  try {
    const { telegram_id, plot_index } = req.body;
    const { data: user } = await supabase.from('users').select('coins').eq('telegram_id', telegram_id).single();

    if (!user || user.coins < 10) return res.status(400).json({ error: "Not enough coins for seed!" });

    const harvestTime = new Date(Date.now() + 13200000).toISOString();

    await supabase.from('users').update({ coins: user.coins - 10 }).eq('telegram_id', telegram_id);
    await supabase.from('plots').update({ 
      status: 'growing', 
      harvest_time: harvestTime, 
      boosted_water: false, 
      boosted_fert: false 
    }).eq('telegram_id', telegram_id).eq('plot_index', plot_index);

    return res.json({ success: true, harvestTime });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 3. HARVEST CROP
app.post('/api/farm/harvest', async (req, res) => {
  try {
    const { telegram_id, plot_index } = req.body;
    const { data: plot } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).eq('plot_index', plot_index).single();

    if (!plot) return res.status(400).json({ error: "Invalid plot index" });

    const now = new Date();
    if (plot.harvest_time && now < new Date(plot.harvest_time)) {
      return res.status(400).json({ error: "Crop is not ready for harvest yet!" });
    }

    const { data: user } = await supabase.from('users').select('coins').eq('telegram_id', telegram_id).single();
    await supabase.from('users').update({ coins: user.coins + 50 }).eq('telegram_id', telegram_id);
    await supabase.from('plots').update({ 
      status: 'empty', 
      harvest_time: null, 
      boosted_water: false, 
      boosted_fert: false 
    }).eq('telegram_id', telegram_id).eq('plot_index', plot_index);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 4. UNLOCK PLOT
app.post('/api/farm/unlock', async (req, res) => {
  try {
    const { telegram_id, plot_index } = req.body;
    const { data: user } = await supabase.from('users').select('coins').eq('telegram_id', telegram_id).single();
    
    if (!user || user.coins < 5000) return res.status(400).json({ error: "Insufficient Coins to unlock plot (Required: 5,000 Coins)" });

    await supabase.from('users').update({ coins: user.coins - 5000 }).eq('telegram_id', telegram_id);
    await supabase.from('plots').update({ status: 'empty' }).eq('telegram_id', telegram_id).eq('plot_index', plot_index);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 5. COMPLETE TASK
app.post('/api/task/claim', async (req, res) => {
  try {
    const { telegram_id, task_code } = req.body;
    const { data: existing } = await supabase.from('completed_tasks').select('*').eq('telegram_id', telegram_id).eq('task_code', task_code).single();
    
    if (existing) return res.status(400).json({ error: "Task already completed!" });

    const { data: user } = await supabase.from('users').select('coins').eq('telegram_id', telegram_id).single();
    await supabase.from('users').update({ coins: user.coins + 150 }).eq('telegram_id', telegram_id);
    await supabase.from('completed_tasks').insert([{ telegram_id, task_code, reward_coins: 150 }]);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 6. MARKET TRANSACTIONS
app.post('/api/market/trade', async (req, res) => {
  try {
    const { telegram_id, action_type, amount } = req.body; 
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();

    if (!user) return res.status(404).json({ error: "User not found" });

    let details = "";
    if (action_type === 'CONVERT') {
      const coinCost = parseInt(amount); 
      if (user.coins < coinCost) return res.status(400).json({ error: "Insufficient Coins for conversion" });
      const atfGain = coinCost / 10000;
      
      await supabase.from('users').update({
        coins: user.coins - coinCost,
        atf_balance: parseFloat(user.atf_balance) + atfGain
      }).eq('telegram_id', telegram_id);
      details = `Converted ${coinCost} Coins to ${atfGain} ATF`;
    } 
    else if (action_type === 'BUY_WATER') {
      const cost = 200; 
      if (user.coins < cost) return res.status(400).json({ error: "Insufficient Coins (Need 200 Coins)" });

      await supabase.from('users').update({
        coins: user.coins - cost,
        water_inventory: user.water_inventory + 1
      }).eq('telegram_id', telegram_id);
      details = `Purchased 1 Water Booster for 200 Coins`;
    } 
    else if (action_type === 'BUY_FERT') {
      const cost = 450; 
      if (user.coins < cost) return res.status(400).json({ error: "Insufficient Coins (Need 450 Coins)" });

      await supabase.from('users').update({
        coins: user.coins - cost,
        fertilizer_inventory: user.fertilizer_inventory + 1
      }).eq('telegram_id', telegram_id);
      details = `Purchased 1 Fertilizer Booster for 450 Coins`;
    }

    await supabase.from('market_history').insert([{ telegram_id, action_type, details, amount_changed: amount.toString() }]);

    return res.json({ success: true, details });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 7. WITHDRAW
app.post('/api/wallet/withdraw', async (req, res) => {
  try {
    const { telegram_id, wallet_address, amount_atf } = req.body;
    if (amount_atf < 5.0) return res.status(400).json({ error: "Minimum withdrawal limit is 5.0 ATF" });

    const { data: user } = await supabase.from('users').select('atf_balance').eq('telegram_id', telegram_id).single();
    if (!user || parseFloat(user.atf_balance) < amount_atf) return res.status(400).json({ error: "Insufficient ATF token balance" });

    await supabase.from('users').update({ atf_balance: parseFloat(user.atf_balance) - amount_atf }).eq('telegram_id', telegram_id);
    await supabase.from('withdrawals').insert([{ telegram_id, wallet_address, amount_atf, status: 'PENDING' }]);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = app;
