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
    const { telegram_id, task_code } = req.body;
    if (!telegram_id || !task_code) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // 1. Check if task already completed by this user
    const { data: existingTask } = await supabase
      .from('completed_tasks')
      .select('*')
      .eq('telegram_id', telegram_id)
      .eq('task_code', task_code)
      .single();

    if (existingTask) {
      return res.status(400).json({ error: "Task already completed!" });
    }

    // 2. Define task rewards (Internal game coins, zero financial risk)
    const rewards = {
      'JOIN_CHANNEL': 100,
      'INVITE_FRIEND': 50,
      'DAILY_CHECKIN': 20
    };

    const rewardCoins = rewards[task_code] || 10;

    // 3. Get user current coins
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('coins')
      .eq('telegram_id', telegram_id)
      .single();

    if (userErr || !user) {
      return res.status(404).json({ error: "User not found" });
    }

    // 4. Update user coins and record completed task atomically
    const { error: updateErr } = await supabase
      .from('users')
      .update({ coins: user.coins + rewardCoins })
      .eq('telegram_id', telegram_id);

    if (updateErr) throw updateErr;

    const { error: taskInsertErr } = await supabase
      .from('completed_tasks')
      .insert([{ telegram_id, task_code, reward_coins: rewardCoins }]);

    if (taskInsertErr) throw taskInsertErr;

    return res.status(200).json({ 
      success: true, 
      reward: rewardCoins, 
      message: `Task completed successfully! Earned ${rewardCoins} coins.` 
    });

  } catch (err) {
    return res.status(500).json({ error: "Server Error: " + err.message });
  }
};