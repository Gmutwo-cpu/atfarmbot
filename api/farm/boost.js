import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { user_id, boost_type } = req.body; // 'WATER' or 'FERTILIZER'

    const { data: farm } = await supabase.from('farms').select('*').eq('user_id', user_id).single();
    if (!farm || !farm.is_planted) {
      return res.status(400).json({ success: false, message: 'No active plant to boost!' });
    }

    let currentDue = new Date(farm.harvest_due_at).getTime();
    let reductionMs = 0;

    if (boost_type === 'WATER') {
      if (farm.water < 1) return res.status(400).json({ success: false, message: 'Not enough Water Supply!' });
      reductionMs = 30 * 60 * 1000; // -30 minutes
      await supabase.from('farms').update({ water: farm.water - 1 }).eq('user_id', user_id);
    } else if (boost_type === 'FERTILIZER') {
      if (farm.fertilizer < 1) return res.status(400).json({ success: false, message: 'Not enough Fertilizer!' });
      reductionMs = 60 * 60 * 1000; // -60 minutes
      await supabase.from('farms').update({ fertilizer: farm.fertilizer - 1 }).eq('user_id', user_id);
    } else {
      return res.status(400).json({ success: false, message: 'Invalid boost type!' });
    }

    let newDue = Math.max(Date.now(), currentDue - reductionMs);

    await supabase.from('farms').update({
      harvest_due_at: new Date(newDue).toISOString(),
      updated_at: new Date()
    }).eq('user_id', user_id);

    return res.status(200).json({ success: true, message: `Boost applied successfully! Timer reduced.` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
