const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { telegram_id, username } = req.body;
    if (!telegram_id) return res.status(400).json({ error: "Missing telegram_id" });

    let { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();

    if (!user) {
      const { data: insertedUser, error: insertErr } = await supabase
        .from('users')
        .insert([{ telegram_id, username: username || 'Farmer', coins: 50, water_inventory: 1, seed_inventory: 1 }])
        .select()
        .single();
      if (insertErr) throw insertErr;
      user = insertedUser;

      // Inisialisasi plot 0 (default terbuka) dan plot 1, 2, 3 (terkunci)
      const initialPlots = [
        { telegram_id, plot_index: 0, status: 'empty' },
        { telegram_id, plot_index: 1, status: 'locked' },
        { telegram_id, plot_index: 2, status: 'locked' },
        { telegram_id, plot_index: 3, status: 'locked' }
      ];
      await supabase.from('plots').insert(initialPlots);
    }

    let { data: plots } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).order('plot_index');
    if (!plots || plots.length === 0) {
      const defaultPlots = [
        { telegram_id, plot_index: 0, status: 'empty' },
        { telegram_id, plot_index: 1, status: 'locked' },
        { telegram_id, plot_index: 2, status: 'locked' },
        { telegram_id, plot_index: 3, status: 'locked' }
      ];
      await supabase.from('plots').insert(defaultPlots);
      const { data: newPlots } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).order('plot_index');
      plots = newPlots;
    }

    const { data: completed_tasks } = await supabase.from('completed_tasks').select('*').eq('telegram_id', telegram_id);

    return res.status(200).json({ success: true, user, plots: plots || [], completed_tasks: completed_tasks || [] });
  } catch (err) {
    return res.status(500).json({ error: "Server Error: " + err.message });
  }
};
