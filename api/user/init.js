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
      return res.status(400).json({ error: "Missing telegram_id parameter" });
    }

    // 1. Check if user exists
    let { data: user, error: userErr } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegram_id)
      .single();

    // 2. If user does not exist, insert new user (Trigger will automatically create plots)
    if (!user) {
      const { data: newUser, error: insertErr } = await supabase
        .from('users')
        .insert([{ telegram_id, username: username || 'Farmer' }])
        .select()
        .single();

      if (insertErr) throw insertErr;
      user = newUser;
    }

    // 3. Fetch user plots
    const { data: plots, error: plotsErr } = await supabase
      .from('plots')
      .select('*')
      .eq('telegram_id', telegram_id)
      .order('plot_index', { ascending: true });

    if (plotsErr) throw plotsErr;

    // 4. Fetch market history
    const { data: history } = await supabase
      .from('market_history')
      .select('*')
      .eq('telegram_id', telegram_id)
      .order('created_at', { ascending: false })
      .limit(10);

    // 5. Fetch completed tasks
    const { data: completedTasks } = await supabase
      .from('completed_tasks')
      .select('*')
      .eq('telegram_id', telegram_id);

    return res.status(200).json({
      success: true,
      user,
      plots: plots || [],
      completed_tasks: completedTasks || [],
      history: history || []
    });

  } catch (err) {
    return res.status(500).json({ error: "Server Error: " + err.message });
  }
};
