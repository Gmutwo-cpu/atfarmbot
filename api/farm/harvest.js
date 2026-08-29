import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ success: false, message: 'Missing user_id!' });

    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Cek batas maksimal panen 5 kali sehari
    const { data: harvestToday } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user_id)
      .eq('type', 'HARVEST_FRUIT')
      .gte('created_at', todayStart.toISOString());

    if (harvestToday && harvestToday.length >= 5) {
      return res.status(400).json({ 
        success: false, 
        message: 'Daily harvest limit reached! Maximum 5 harvests per day.' 
      });
    }

    const { data: farm, error: farmError } = await supabase
      .from('farms')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (farmError || !farm) return res.status(404).json({ success: false, message: 'Farm not found!' });

    if (!farm.is_planted) {
      return res.status(400).json({ success: false, message: 'No active plant on your land!' });
    }

    if (new Date() < new Date(farm.harvest_due_at)) {
      return res.status(400).json({ success: false, message: 'Plant is still growing! Please wait until due time.' });
    }

    // Reset status lahan dan tambah buah
    await supabase.from('farms').update({
      is_planted: false,
      harvest_due_at: null,
      fruits: farm.fruits + 1,
      updated_at: now
    }).eq('user_id', user_id);

    // Catat transaksi panen
    await supabase.from('transactions').insert([{
      user_id,
      type: 'HARVEST_FRUIT',
      amount: 1,
      currency_type: 'FRUITS',
      description: 'Harvested 1x Apple Fruit'
    }]);

    return res.status(200).json({ success: true, message: 'Successfully harvested 1x Apple Fruit!' });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
  }
}
