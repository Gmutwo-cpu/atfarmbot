import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ success: false, message: 'Missing user_id!' });
    }

    // Ambil data farm user
    const { data: farm, error: farmError } = await supabase
      .from('farms')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (farmError || !farm) {
      return res.status(404).json({ success: false, message: 'Farm data not found!' });
    }

    if (!farm.is_planted) {
      return res.status(400).json({ success: false, message: 'No active crop growing on this land!' });
    }

    // Validasi waktu panen
    let now = new Date().getTime();
    let dueTime = new Date(farm.harvest_due_at).getTime();

    if (now < dueTime) {
      return res.status(400).json({ success: false, message: 'Crop is still growing! Please wait or use boosters.' });
    }

    // Eksekusi panen: Tambah 1 fruits, reset status lahan
    const { error: updateError } = await supabase
      .from('farms')
      .update({
        fruits: farm.fruits + 1,
        is_planted: false,
        harvest_due_at: null,
        updated_at: new Date()
      })
      .eq('user_id', user_id);

    if (updateError) throw updateError;

    return res.status(200).json({ 
      success: true, 
      message: 'Successfully harvested 1 Apple Fruit! Check your inventory.' 
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
  }
}
