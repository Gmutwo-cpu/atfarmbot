const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { telegram_id, username } = req.body;
    if (!telegram_id) {
      return res.status(400).json({ error: "Missing telegram_id" });
    }

    // 1. Check if user exists
    let { data: user, error: userErr } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegram_id)
      .single();

    // 2. If user doesn't exist, create with Guaranteed Starter Pack (50 Coins, 1 Water, 1 Seed)
    if (!user) {
      const newUserObj = {
        telegram_id,
        username: username || 'Farmer',
        coins: 50,          // Starter Pack Coins
        water_inventory: 1, // Starter Pack Water
        fertilizer_inventory: 0,
        seed_inventory: 1,  // Starter Seed
        fruit_inventory: 0,
        atf_balance: 0.0000,
        is_vip: false
      };

      const { data: insertedUser, error: insertErr } = await supabase
        .from('users')
        .insert([newUserObj])
        .select()
        .single();

      if (insertErr) throw insertErr;
      user = insertedUser;

      // Initialize default plots for new user (4 plots: Plot 1 unlocked, others locked)
      const initialPlots = [
        { telegram_id, plot_index: 1, status: 'empty', harvest_time: null },
        { telegram_id, plot_index: 2, status: 'locked', harvest_time: null },
        { telegram_id, plot_index: 3, status: 'locked', harvest_time: null },
        { telegram_id, plot_index: 4, status: 'locked', harvest_time: null }
      ];
      await supabase.from('plots').insert(initialPlots);
    } else {
      // Safety check: ensure existing user who had 0 coins gets their starter boost if coins/seeds are null
      let updates = {};
      let needsUpdate = false;
      if (user.coins === undefined || user.coins === null) { updates.coins = 50; needsUpdate = true; }
      if (user.water_inventory === undefined || user.water_inventory === null) { updates.water_inventory = 1; needsUpdate = true; }
      if (user.seed_inventory === undefined || user.seed_inventory === null) { updates.seed_inventory = 1; needsUpdate = true; }

      if (needsUpdate) {
        const { data: updatedUser } = await supabase
          .from('users')
          .update(updates)
          .eq('telegram_id', telegram_id)
          .select()
          .single();
        if (updatedUser) user = updatedUser;
      }
    }

    // 3. Fetch user plots
    const { data: plots } = await supabase
      .from('plots')
      .select('*')
      .eq('telegram_id', telegram_id)
      .order('plot_index', { ascending: true });

    // 4. Fetch completed tasks
    const { data: completed_tasks } = await supabase
      .from('completed_tasks')
      .select('*')
      .eq('telegram_id', telegram_id);

    return res.status(200).json({
      success: true,
      user,
      plots: plots || [],
      completed_tasks: completed_tasks || []
    });

  } catch (err) {
    return res.status(500).json({ error: "Server Error: " + err.message });
  }
};
