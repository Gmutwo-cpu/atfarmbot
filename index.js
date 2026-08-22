const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// 1. INIT USER & SYNC STATE
app.post('/api/user/init', async (req, res) => {
  try {
    const { telegram_id, username } = req.body;
    if (!telegram_id) return res.status(400).json({ error: "Missing telegram_id" });

    let { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();

    if (!user) {
      const { data: newUser, error } = await supabase.from('users').insert([{
        telegram_id,
        username: username || 'Farmer',
        coins: 100,
        atf_balance: 0,
        water_inventory: 1,
        fertilizer_inventory: 1
      }]).select().single();
      
      if (error) throw error;
      user = newUser;
    }

    let { data: plots } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).order('plot_index', { ascending: true });
    
    // Fallback jika trigger supabase belum jalan
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

    return res.json({ success: true, user, plots });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 2. PLANT SEED
app.post('/api/farm/plant', async (req, res) => {
  try {
    const { telegram_id, plot_index } = req.body;
    const { data: user } = await supabase.from('users').select('coins').eq('telegram_id', telegram_id).single();

    if (!user || user.coins < 10) return res.status(400).json({ error: "Not enough coins for seed!" });

    const harvestTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase.from('users').update({ coins: user.coins - 10 }).eq('telegram_id', telegram_id);
    await supabase.from('plots').update({ status: 'growing', harvest_time: harvestTime, crop_type: 'apple' }).eq('telegram_id', telegram_id).eq('plot_index', plot_index);

    return res.json({ success: true, harvestTime });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 3. HARVEST APPLE
app.post('/api/farm/harvest', async (req, res) => {
  try {
    const { telegram_id, plot_index } = req.body;
    const { data: plot } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).eq('plot_index', plot_index).single();

    if (!plot) return res.status(400).json({ error: "Invalid plot" });

    const now = new Date();
    if (plot.harvest_time && now < new Date(plot.harvest_time)) {
      return res.status(400).json({ error: "Crop is not ready yet!" });
    }

    const { data: user } = await supabase.from('users').select('coins').eq('telegram_id', telegram_id).single();
    await supabase.from('users').update({ coins: user.coins + 50 }).eq('telegram_id', telegram_id);
    await supabase.from('plots').update({ status: 'empty', harvest_time: null, boosted_water: false, boosted_fert: false }).eq('telegram_id', telegram_id).eq('plot_index', plot_index);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 4. MARKET CONVERT
app.post('/api/market/convert', async (req, res) => {
  try {
    const { telegram_id, coin_amount } = req.body;
    const { data: user } = await supabase.from('users').select('coins, atf_balance').eq('telegram_id', telegram_id).single();
    if (user.coins < coin_amount) return res.status(400).json({ error: "Insufficient Coins" });

    const atfGained = coin_amount / 10000;
    await supabase.from('users').update({
      coins: user.coins - coin_amount,
      atf_balance: parseFloat(user.atf_balance) + atfGained
    }).eq('telegram_id', telegram_id);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 5. WITHDRAW
app.post('/api/wallet/withdraw', async (req, res) => {
  try {
    const { telegram_id, wallet_address, amount_atf } = req.body;
    if (amount_atf < 5.0) return res.status(400).json({ error: "Minimum withdraw 5.0 ATF" });

    const { data: user } = await supabase.from('users').select('atf_balance').eq('telegram_id', telegram_id).single();
    if (parseFloat(user.atf_balance) < amount_atf) return res.status(400).json({ error: "Insufficient ATF balance" });

    await supabase.from('users').update({ atf_balance: parseFloat(user.atf_balance) - amount_atf }).eq('telegram_id', telegram_id);
    await supabase.from('withdrawals').insert([{ telegram_id, wallet_address, amount_atf, status: 'PENDING' }]);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = app;
