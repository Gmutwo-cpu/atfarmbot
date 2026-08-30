import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { user_id } = req.body;
    if (!user_id) {
      return res.status(400).json({ success: false, message: 'Invalid user ID!' });
    }

    let { data: farm, error: farmErr } = await supabase
      .from('farms')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (farmErr || !farm || !farm.is_planted) {
      return res.status(400).json({ success: false, message: 'No active plant found on your farm!' });
    }

    // Validasi waktu panen (5 jam 40 menit)
    let now = new Date();
    let dueAt = new Date(farm.harvest_due_at);
    if (now < dueAt) {
      return res.status(400).json({ success: false, message: 'Apple tree is still growing!' });
    }

    // Update status lahan kembali kosong dan tambah buah
    let newFruits = Number(farm.fruits || 0) + 1;
    let { error: updateErr } = await supabase
      .from('farms')
      .update({
        is_planted: false,
        harvest_due_at: null,
        fruits: newFruits
      })
      .eq('user_id', user_id);

    if (updateErr) {
      throw new Error('Failed to update harvest state.');
    }

    // Catat histori transaksi
    await supabase.from('transactions').insert([
      {
        telegram_id: user_id,
        type: 'HARVEST',
        description: 'Successfully harvested 1 Apple fruit.'
      }
    ]);

    return res.status(200).json({
      success: true,
      message: 'Harvest successful! +1 Apple added to your storage.',
      fruits: newFruits
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Exception: ' + err.message });
  }
}
