import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { user_id } = req.body;

    // Cek stok benih user
    const { data: farm } = await supabase.from('farms').select('*').eq('user_id', user_id).single();
    if (!farm || farm.seeds < 1) {
      return res.status(400).json({ success: false, message: 'Insufficient Crop Seeds!' });
    }
    if (farm.is_planted) {
      return res.status(400).json({ success: false, message: 'Land is already active with a growing tree!' });
    }

    // Durasi tumbuh 5 jam 40 menit dari sekarang
    const harvestDue = new Date(Date.now() + 5 * 3600 * 1000 + 40 * 60 * 1000);

    // Kurangi benih 1, ubah status jadi planted
    await supabase.from('farms').update({
      seeds: farm.seeds - 1,
      is_planted: true,
      harvest_due_at: harvestDue.toISOString(),
      updated_at: new Date()
    }).eq('user_id', user_id);

    return res.status(200).json({ success: true, message: 'Apple seed planted successfully!', harvest_due_at: harvestDue });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
