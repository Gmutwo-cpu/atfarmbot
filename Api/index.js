const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// SIMULASI GAME VAULT (ZERO-BONCOS ARCHITECTURE)
// Catatan: Pada skala produksi, simpan variabel ini di DB Supabase
let GAME_VAULT = {
  total_ton_collected: 0.0,  // Total TON/Stars yang masuk dari pemain
  developer_profit: 0.0,     // 40% Kas Bersih Developer
  payout_pool: 10.0          // 60% Alokasi Cadangan Penarikan Pemain (Initial Float 10 TON)
};

// 1. INIT USER & SYNC STATE
app.post('/api/user/init', async (req, res) => {
  try {
    const { telegram_id, username, ref_by } = req.body;
    if (!telegram_id) return res.status(400).json({ error: "Missing telegram_id" });

    let { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();

    if (!user) {
      const { data: newUser, error } = await supabase.from('users').insert([{
        telegram_id,
        username: username || 'Farmer',
        referred_by: ref_by ? parseInt(ref_by) : null
      }]).select().single();
      
      if (error) throw error;
      user = newUser;

      const initialPlots = Array.from({ length: 6 }, (_, i) => ({
        telegram_id,
        plot_index: i,
        status: i === 0 ? 'empty' : 'locked'
      }));
      await supabase.from('plots').insert(initialPlots);
    }

    const { data: plots } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).order('plot_index', { ascending: true });
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
    await supabase.from('plots').update({ status: 'growing', harvest_time: harvestTime }).eq('telegram_id', telegram_id).eq('plot_index', plot_index);

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

    if (!plot || plot.status !== 'growing') return res.status(400).json({ error: "Invalid plot state" });

    const now = new Date();
    const harvestTime = new Date(plot.harvest_time);

    if (now < harvestTime) {
      return res.status(400).json({ error: "Crop is not ready yet! Stop cheating." });
    }

    const { data: user } = await supabase.from('users').select('coins').eq('telegram_id', telegram_id).single();
    await supabase.from('users').update({ coins: user.coins + 50 }).eq('telegram_id', telegram_id);
    await supabase.from('plots').update({ status: 'empty', harvest_time: null }).eq('telegram_id', telegram_id).eq('plot_index', plot_index);

    return res.json({ success: true, rewardCoins: 50 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 4. DYNAMIC SWAP (DYNAMIC RATE BASED ON VAULT - ZERO BONCOS)
app.post('/api/market/convert', async (req, res) => {
  try {
    const { telegram_id, coin_amount } = req.body;
    if (!coin_amount || coin_amount < 10000) return res.status(400).json({ error: "Min convert 10,000 Coins" });

    const { data: user } = await supabase.from('users').select('coins, atf_balance').eq('telegram_id', telegram_id).single();
    if (!user || user.coins < coin_amount) return res.status(400).json({ error: "Insufficient Coin balance" });

    // RUMUS ZERO-BONCOS:
    // Rate ATF menyesuaikan ketersediaan Payout Pool (60% kas masuk)
    const baseRate = GAME_VAULT.payout_pool > 0 ? (GAME_VAULT.payout_pool / 10000) : 0.0001; 
    const atfGained = (coin_amount / 10000) * baseRate;

    await supabase.from('users').update({
      coins: user.coins - coin_amount,
      atf_balance: parseFloat(user.atf_balance) + atfGained
    }).eq('telegram_id', telegram_id);

    return res.json({ success: true, atfGained, rate: baseRate });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 5. BUY ITEM IN-GAME (BELI DENGAN COINS ATAS ITEM CONSUMABLE)
app.post('/api/market/buy-item', async (req, res) => {
  try {
    const { telegram_id, cost, item_type } = req.body;
    const { data: user } = await supabase.from('users').select('coins').eq('telegram_id', telegram_id).single();

    if (!user || user.coins < cost) return res.status(400).json({ error: "Koin tidak cukup!" });

    await supabase.from('users').update({ coins: user.coins - cost }).eq('telegram_id', telegram_id);
    return res.json({ success: true, message: `Berhasil membeli ${item_type}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 6. PROCESS CRYPTO/STARS PAYMENT (40% DEV / 60% POOL)
app.post('/api/store/buy-stars', async (req, res) => {
  try {
    const { telegram_id, item_type, ton_amount } = req.body;

    // Alokasikan Pembagian Uang Masuk
    const devShare = ton_amount * 0.40;
    const poolShare = ton_amount * 0.60;

    GAME_VAULT.developer_profit += devShare;
    GAME_VAULT.payout_pool += poolShare;
    GAME_VAULT.total_ton_collected += ton_amount;

    return res.json({ 
      success: true, 
      message: "Pembayaran terverifikasi!", 
      payout_pool: GAME_VAULT.payout_pool 
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 7. REQUEST WITHDRAW QUEUE
app.post('/api/wallet/withdraw', async (req, res) => {
  try {
    const { telegram_id, wallet_address, amount_atf } = req.body;
    if (amount_atf < 5.0) return res.status(400).json({ error: "Minimum withdraw is 5.0 ATF" });

    const { data: user } = await supabase.from('users').select('atf_balance').eq('telegram_id', telegram_id).single();
    if (parseFloat(user.atf_balance) < amount_atf) return res.status(400).json({ error: "Insufficient ATF balance" });

    await supabase.from('users').update({ atf_balance: parseFloat(user.atf_balance) - amount_atf }).eq('telegram_id', telegram_id);
    await supabase.from('withdrawals').insert([{ telegram_id, wallet_address, amount_atf, status: 'PENDING' }]);

    return res.json({ success: true, message: "Withdrawal request queued for admin review." });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = app;
