const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { telegram_id, plot_index } = req.body;
    let { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    if (!user) return res.status(404).json({ error: 'User not found' });

    if ((user.fertilizer_inventory || 0) <= 0) {
      return res.status(400).json({ error: 'No fertilizer available in inventory!' });
    }

    const { data: plot } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).eq('plot_index', plot_index).single();
    if (!plot || plot.status !== 'growing') {
      return res.status(400).json({ error: 'No growing crop to boost.' });
    }

    // Mengurangi persediaan pupuk dan langsung menyelesaikan waktu panen
    await supabase.from('users').update({ fertilizer_inventory: user.fertilizer_inventory - 1 }).eq('telegram_id', telegram_id);
    await supabase.from('plots').update({ harvest_time: new Date().toISOString() }).eq('telegram_id', telegram_id).eq('plot_index', plot_index);

    const { data: updatedUser } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    const { data: plots } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).order('plot_index');

    return res.status(200).json({ success: true, message: 'Crop boosted successfully with fertilizer!', user: updatedUser, plots });
  } catch (err) {
    return res.status(500).json({ error: 'Server Error: ' + err.message });
  }
};
