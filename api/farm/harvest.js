import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  try {
    const { user_id, plot_index } = req.body;
    if (!user_id || plot_index === undefined) {
      return res.status(400).json({ success: false, message: 'Missing parameters!' });
    }

    let { data: plot } = await supabase.from('user_plots')
      .select('*')
      .eq('user_id', user_id)
      .eq('plot_index', plot_index)
      .single();

    if (!plot || plot.status !== 'PLANTED') {
      return res.status(400).json({ success: false, message: 'No active crop on this plot!' });
    }

    if (new Date() < new Date(plot.harvest_due_at)) {
      return res.status(400).json({ success: false, message: 'Crop is still growing!' });
    }

    const fruitRewards = { 'APPLE': 1, 'STRAWBERRY': 2, 'ORANGE': 5 };
    let rewardFruits = fruitRewards[plot.crop_type] || 1;

    let { data: farm } = await supabase.from('farms').select('*').eq('user_id', user_id).single();
    let currentFruits = Number(farm.fruits || 0) + rewardFruits;

    // Reset plot menjadi kosong & tambah buah ke farm
    await supabase.from('user_plots').update({
      status: 'EMPTY',
      crop_type: 'APPLE',
      harvest_due_at: null
    }).eq('id', plot.id);

    await supabase.from('farms').update({ fruits: currentFruits }).eq('user_id', user_id);

    await supabase.from('transactions').insert([{
      user_id,
      type: 'HARVEST',
      description: `Harvested ${rewardFruits}x fruits from ${plot.crop_type} (Plot #${plot_index}).`
    }]);

    return res.status(200).json({ success: true, message: `Harvest successful! Got ${rewardFruits} fruits from Plot #${plot_index}.` });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
}
