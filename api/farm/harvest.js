import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  try {
    const { user_id, plot_index } = req.body;
    let { data: plot } = await supabase.from('user_plots')
      .select('*')
      .eq('telegram_id', user_id)
      .eq('plot_index', plot_index)
      .single();

    if (!plot || !plot.is_planted) {
      return res.status(400).json({ success: false, message: 'No active plant on this plot!' });
    }

    if (new Date() < new Date(plot.harvest_due_at)) {
      return res.status(400).json({ success: false, message: 'Crop is not ready to harvest yet!' });
    }

    let { data: user } = await supabase.from('users').select('*').eq('telegram_id', user_id).single();
    
    // Reward buah berdasarkan jenis tanaman
    const fruitRewards = { 'APPLE': 1, 'STRAWBERRY': 2, 'COFFEE': 4 };
    let rewardFruits = fruitRewards[plot.crop_type] || 1;

    // Reset status plot
    await supabase.from('user_plots').update({
      is_planted: false,
      harvest_due_at: null
    }).eq('id', plot.id);

    let currentFruits = Number(user.fruits || 0) + rewardFruits;
    await supabase.from('users').update({ fruits: currentFruits }).eq('telegram_id', user_id);

    await supabase.from('transactions').insert([{
      telegram_id: user_id,
      type: 'HARVEST',
      description: `Harvested ${rewardFruits}x fruits from ${plot.crop_type} (Plot ${plot_index}).`
    }]);

    return res.status(200).json({ success: true, message: `Harvest successful! Got ${rewardFruits} fruits.` });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
}
