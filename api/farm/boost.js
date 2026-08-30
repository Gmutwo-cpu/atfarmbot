import { supabase } from '../../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { user_id, boost_type } = req.body;

    if (!user_id || !boost_type) {
      return res.status(400).json({ success: false, message: 'Missing user_id or boost_type!' });
    }

    // Ambil data status farm pengguna saat ini
    const { data: farm, error: farmError } = await supabase
      .from('farms')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (farmError || !farm) {
      return res.status(404).json({ success: false, message: 'Farm data not found!' });
    }

    if (!farm.is_planted) {
      return res.status(400).json({ success: false, message: 'No active plant to boost!' });
    }

    let currentDueTime = new Date(farm.harvest_due_at).getTime();
    let reductionMs = 0;

    // Periksa jenis booster dan kurangi stok sumber daya
    if (boost_type === 'WATER') {
      if (farm.water < 1) {
        return res.status(400).json({ success: false, message: 'Not enough Water Supply! Buy more in Market.' });
      }
      reductionMs = 30 * 60 * 1000; // -30 menit
      await supabase.from('farms').update({ water: farm.water - 1 }).eq('user_id', user_id);
    } 
    else if (boost_type === 'FERTILIZER') {
      if (farm.fertilizer < 1) {
        return res.status(400).json({ success: false, message: 'Not enough Fertilizer! Buy more in Market.' });
      }
      reductionMs = 60 * 60 * 1000; // -60 menit
      await supabase.from('farms').update({ fertilizer: farm.fertilizer - 1 }).eq('user_id', user_id);
    } 
    else {
      return res.status(400).json({ success: false, message: 'Invalid boost type!' });
    }

    // Hitung waktu baru (pastikan tidak kurang dari waktu saat ini)
    let newDueTime = Math.max(Date.now(), currentDueTime - reductionMs);

    // Perbarui database dengan waktu panen yang sudah dipercepat
    const { error: updateError } = await supabase
      .from('farms')
      .update({
        harvest_due_at: new Date(newDueTime).toISOString(),
        updated_at: new Date()
      })
      .eq('user_id', user_id);

    if (updateError) throw updateError;

    return res.status(200).json({ 
      success: true, 
      message: `Successfully applied ${boost_type} booster! Timer reduced.` 
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
  }
}
