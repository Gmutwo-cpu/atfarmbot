import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { user_id } = req.body;

    const { data: farm } = await supabase.from('farms').select('*').eq('user_id', user_id).single();
    if (!farm || !farm.is_planted) {
      return res.status(400).json({ success: false, message: 'No active crop to harvest!' });
    }

    if (new Date() < new Date(farm.harvest_due_at)) {
      return res.status(400).json({ success: false, message: 'Crop is still growing! Please wait.' });
    }

    // Tambah 1 buah hasil panen, reset status tanam
    await supabase.from('farms').update({
      fruits: farm.fruits + 1,
      is_planted: false,
      harvest_due_at: null,
      updated_at: new Date()
    }).eq('user_id', user_id);

    return res.status(200).json({ success: true, message: 'Successfully harvested 1 Apple Fruit!' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
