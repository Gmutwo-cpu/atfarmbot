import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { user_id } = req.body;
    if (!user_id) {
      return res.status(400).json({ success: false, message: 'Missing parameters!' });
    }

    // Ambil data farm user
    let { data: farm, error: farmErr } = await supabase
      .from('farms')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (farmErr || !farm) {
      return res.status(404).json({ success: false, message: 'Farm data not found!' });
    }

    if (farm.is_planted) {
      return res.status(400).json({ success: false, message: 'Land is already planted!' });
    }

    if (farm.seeds <= 0) {
      return res.status(400).json({ success: false, message: 'You have no seeds left! Please buy seeds in the market.' });
    }

    // Kurangi jumlah seed dan aktifkan status tanam dengan durasi 5 jam 40 menit
    let newSeeds = farm.seeds - 1;
    let harvestDue = new Date(Date.now() + (5 * 60 + 40) * 60000).toISOString();

    let { error: updateErr } = await supabase
      .from('farms')
      .update({
        seeds: newSeeds,
        is_planted: true,
        harvest_due_at: harvestDue
      })
      .eq('user_id', user_id);

    if (updateErr) {
      throw new Error('Failed to plant seed.');
    }

    // Catat riwayat transaksi
    await supabase.from('transactions').insert([
      {
        telegram_id: user_id,
        type: 'PLANT',
        description: 'Planted an Apple seed.'
      }
    ]);

    return res.status(200).json({
      success: true,
      message: 'Successfully planted Apple seed! Timer started (5h 40m).'
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Exception: ' + err.message });
  }
}
