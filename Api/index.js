const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// SIMULASI ALOKASI PENDAPATAN PROYEK (70% Dev / 30% Player Reward Pool)
let DEV_REVENUE = {
  developer_profit_usd: 0.0, // 70% Untuk Operasional & Biaya Hidup Pengembang
  atf_buyback_pool_usd: 0.0  // 30% Dibelikan Token ATF di DEX untuk Pembagian Pemain
};

// 1. INIT USER & SYNC STATE[cite: 6]
app.post('/api/user/init', async (req, res) => {
  try {
    const { telegram_id, username, ref_by } = req.body;[cite: 6]
    if (!telegram_id) return res.status(400).json({ error: "Missing telegram_id" });[cite: 6]

    let { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();[cite: 6]

    if (!user) {
      const { data: newUser, error } = await supabase.from('users').insert([{[cite: 6]
        telegram_id,[cite: 6]
        username: username || 'Farmer',[cite: 6]
        referred_by: ref_by ? parseInt(ref_by) : null[cite: 6]
      }]).select().single();[cite: 6]
      
      if (error) throw error;[cite: 6]
      user = newUser;[cite: 6]

      // Inisialisasi 6 Plot Lahan (Plot 0 terbuka, sisa terkunci)[cite: 6]
      const initialPlots = Array.from({ length: 6 }, (_, i) => ({[cite: 6]
        telegram_id,[cite: 6]
        plot_index: i,[cite: 6]
        status: i === 0 ? 'empty' : 'locked'[cite: 6]
      }));[cite: 6]
      await supabase.from('plots').insert(initialPlots);[cite: 6]
    }

    const { data: plots } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).order('plot_index', { ascending: true });[cite: 6]
    return res.json({ success: true, user, plots });[cite: 6]
  } catch (err) {
    return res.status(500).json({ error: err.message });[cite: 6]
  }
});

// 2. PLANT SEED (SERVER-SIDE TIMER)[cite: 6]
app.post('/api/farm/plant', async (req, res) => {
  try {
    const { telegram_id, plot_index } = req.body;[cite: 6]
    const { data: user } = await supabase.from('users').select('coins').eq('telegram_id', telegram_id).single();[cite: 6]

    if (!user || user.coins < 10) return res.status(400).json({ error: "Not enough coins for seed!" });[cite: 6]

    // Potong 10 Koin untuk beli bibit, atur panen 10 menit dari waktu server[cite: 6]
    const harvestTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();[cite: 6]

    await supabase.from('users').update({ coins: user.coins - 10 }).eq('telegram_id', telegram_id);[cite: 6]
    await supabase.from('plots').update({ status: 'growing', harvest_time: harvestTime }).eq('telegram_id', telegram_id).eq('plot_index', plot_index);[cite: 6]

    return res.json({ success: true, harvestTime });[cite: 6]
  } catch (err) {
    return res.status(500).json({ error: err.message });[cite: 6]
  }
});

// 3. HARVEST APPLE (ANTI-CHEAT VALIDATION)[cite: 6]
app.post('/api/farm/harvest', async (req, res) => {
  try {
    const { telegram_id, plot_index } = req.body;[cite: 6]
    const { data: plot } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).eq('plot_index', plot_index).single();[cite: 6]

    if (!plot || plot.status !== 'growing') return res.status(400).json({ error: "Invalid plot state" });[cite: 6]

    const now = new Date();[cite: 6]
    const harvestTime = new Date(plot.harvest_time);[cite: 6]

    if (now < harvestTime) {[cite: 6]
      return res.status(400).json({ error: "Crop is not ready yet! Stop cheating." });[cite: 6]
    }

    // Tambah 50 Koin hasil panen apel[cite: 6]
    const { data: user } = await supabase.from('users').select('coins').eq('telegram_id', telegram_id).single();[cite: 6]
    await supabase.from('users').update({ coins: user.coins + 50 }).eq('telegram_id', telegram_id);[cite: 6]
    await supabase.from('plots').update({ status: 'empty', harvest_time: null }).eq('telegram_id', telegram_id).eq('plot_index', plot_index);[cite: 6]

    return res.json({ success: true, rewardCoins: 50 });[cite: 6]
  } catch (err) {
    return res.status(500).json({ error: err.message });[cite: 6]
  }
});

// 4. KLAIM REWARD IKLAN (Sistem Pembagian 70% Dev / 30% Player)
app.post('/api/task/claim-ad', async (req, res) => {
  try {
    const { telegram_id } = req.body;
    
    // Nilai perkiraan dari 1 impresi iklan ($0.01 USD)
    const adValueUsd = 0.01; 
    
    // Alokasi Otomatis
    DEV_REVENUE.developer_profit_usd += (adValueUsd * 0.70); // $0.007 untuk Anda (Developer)
    DEV_REVENUE.atf_buyback_pool_usd += (adValueUsd * 0.30); // $0.003 untuk Pembelian ATF

    const { data: user } = await supabase.from('users').select('coins').eq('telegram_id', telegram_id).single();
    await supabase.from('users').update({ coins: user.coins + 100 }).eq('telegram_id', telegram_id);

    return res.json({ success: true, message: "Reward Iklan Berhasil! +100 Coins" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 5. KONVERSI SLOW ACCUMULATION (Koin ke Token ATF)
app.post('/api/market/convert-slow', async (req, res) => {
  try {
    const { telegram_id, coin_amount } = req.body;
    if (coin_amount < 5000) return res.status(400).json({ error: "Minimal 5,000 Coins untuk klaim ATF!" });

    const { data: user } = await supabase.from('users').select('coins, atf_balance').eq('telegram_id', telegram_id).single();
    if (user.coins < coin_amount) return res.status(400).json({ error: "Koin tidak cukup!" });

    // Rate penukaran perlahan (Disesuaikan dengan pool 30% iklan)
    const atfEarned = (coin_amount / 5000) * 0.05;

    await supabase.from('users').update({
      coins: user.coins - coin_amount,
      atf_balance: parseFloat(user.atf_balance) + atfEarned
    }).eq('telegram_id', telegram_id);

    return res.json({ success: true, atfEarned });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 6. REQUEST WITHDRAW QUEUE[cite: 6]
app.post('/api/wallet/withdraw', async (req, res) => {
  try {
    const { telegram_id, wallet_address, amount_atf } = req.body;[cite: 6]
    if (amount_atf < 5.0) return res.status(400).json({ error: "Minimum withdraw is 5.0 ATF" });[cite: 6]

    const { data: user } = await supabase.from('users').select('atf_balance').eq('telegram_id', telegram_id).single();[cite: 6]
    if (parseFloat(user.atf_balance) < amount_atf) return res.status(400).json({ error: "Insufficient ATF balance" });[cite: 6]

    // Potong saldo & masukkan antrean[cite: 6]
    await supabase.from('users').update({ atf_balance: parseFloat(user.atf_balance) - amount_atf }).eq('telegram_id', telegram_id);[cite: 6]
    await supabase.from('withdrawals').insert([{ telegram_id, wallet_address, amount_atf, status: 'PENDING' }]);[cite: 6]

    return res.json({ success: true, message: "Withdrawal request queued for admin review." });[cite: 6]
  } catch (err) {
    return res.status(500).json({ error: err.message });[cite: 6]
  }
});

module.exports = app;[cite: 6]
