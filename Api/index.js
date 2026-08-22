const express = require('express');
const app = express();
app.use(express.json());

// In-Memory Database Dummy (Ganti dengan PostgreSQL/MongoDB di produksi)
let users = {};
let plots = {};

// Helper: Hitung Durasi Panen (Default: 3 Jam 40 Menit = 13,200,000 ms)
const BASE_HARVEST_TIME_MS = (3 * 3600 + 40 * 60) * 1000;

// 1. INIT USER & PLOTS
app.post('/api/user/init', (req, res) => {
  const { telegram_id, username } = req.body;
  
  if (!users[telegram_id]) {
    // Inisialisasi User Baru dengan Bonus Gratis Pertama (Air & Pupuk)
    users[telegram_id] = {
      telegram_id,
      username,
      coins: 500,
      atf_balance: 0.0,
      water_inventory: 1,      // Booster gratis awal
      fertilizer_inventory: 1  // Booster gratis awal
    };

    // Inisialisasi Plot Lahan (Plot 0 terbuka, Plot 1 terkunci - Soft P2W)
    plots[telegram_id] = [
      { plot_index: 0, status: 'empty', planted_at: null, harvest_at: null, boosted_water: false, boosted_fert: false },
      { plot_index: 1, status: 'locked', cost_coins: 5000, cost_ton: 0.2 }
    ];
  }

  res.json({ success: true, user: users[telegram_id], plots: plots[telegram_id] });
});

// 2. PLANTING (BERTANAM)
app.post('/api/farm/plant', (req, res) => {
  const { telegram_id, plot_index } = req.body;
  const user = users[telegram_id];
  const userPlot = plots[telegram_id]?.[plot_index];

  if (!user || !userPlot) return res.status(400).json({ error: "User or Plot not found" });
  if (user.coins < 10) return res.status(400).json({ error: "Not enough coins!" });
  if (userPlot.status !== 'empty') return res.status(400).json({ error: "Plot is not empty" });

  const now = Date.now();
  user.coins -= 10;
  userPlot.status = 'growing';
  userPlot.planted_at = now;
  userPlot.harvest_at = now + BASE_HARVEST_TIME_MS; // 3 jam 40 menit
  userPlot.boosted_water = false;
  userPlot.boosted_fert = false;

  res.json({ success: true });
});

// 3. USE BOOST (AIR 20% & PUPUK 40%)
app.post('/api/farm/boost', (req, res) => {
  const { telegram_id, plot_index, boost_type } = req.body;
  const user = users[telegram_id];
  const userPlot = plots[telegram_id]?.[plot_index];

  if (userPlot.status !== 'growing') return res.status(400).json({ error: "Crop is not growing" });

  let reductionPercentage = 0;

  if (boost_type === 'water') {
    if (user.water_inventory <= 0) return res.status(400).json({ error: "No Water left! Buy in Market." });
    if (userPlot.boosted_water) return res.status(400).json({ error: "Water already applied to this crop!" });
    
    user.water_inventory -= 1;
    userPlot.boosted_water = true;
    reductionPercentage = 0.20; // 20%
  } else if (boost_type === 'fertilizer') {
    if (user.fertilizer_inventory <= 0) return res.status(400).json({ error: "No Fertilizer left! Buy in Market." });
    if (userPlot.boosted_fert) return res.status(400).json({ error: "Fertilizer already applied to this crop!" });
    
    user.fertilizer_inventory -= 1;
    userPlot.boosted_fert = true;
    reductionPercentage = 0.40; // 40%
  }

  // Pangkas sisa waktu tanam
  const timeReductionMs = BASE_HARVEST_TIME_MS * reductionPercentage;
  userPlot.harvest_at -= timeReductionMs;

  res.json({ success: true, remaining_time: userPlot.harvest_at - Date.now() });
});

// 4. UNLOCK PLOT (SOFT P2W)
app.post('/api/farm/unlock', (req, res) => {
  const { telegram_id, plot_index, method } = req.body;
  const user = users[telegram_id];
  const userPlot = plots[telegram_id]?.[plot_index];

  if (method === 'coins') {
    if (user.coins < userPlot.cost_coins) return res.status(400).json({ error: "Not enough Coins!" });
    user.coins -= userPlot.cost_coins;
    userPlot.status = 'empty';
  }

  res.json({ success: true });
});

// 5. HARVEST
app.post('/api/farm/harvest', (req, res) => {
  const { telegram_id, plot_index } = req.body;
  const user = users[telegram_id];
  const userPlot = plots[telegram_id]?.[plot_index];

  if (Date.now() < userPlot.harvest_at) {
    return res.status(400).json({ error: "Crop is not ready yet!" });
  }

  user.coins += 50;
  userPlot.status = 'empty';
  res.json({ success: true });
});

module.exports = app;
