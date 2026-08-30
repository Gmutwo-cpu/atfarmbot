import { supabase } from '../../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  try {
    const { user_id, plot_index, crop_type } = req.body;
    if (!user_id || plot_index === undefined || !crop_type) {
      return res.status(400).json({ success: false, message: 'Missing parameters!' });
    }

    // Konfigurasi Bibit: Durasi & Harga Koin
    const cropConfigs = {
      'APPLE': { durationMinutes: 340, cost: 10, rewardFruits: 1 },      // 5 jam 40 min
      'STRAWBERRY': { durationMinutes: 120, cost: 25, rewardFruits: 2 }, // 2 jam
      'ORANGE': { durationMinutes: 600, cost: 60, rewardFruits: 5 }      // 10 jam
    };

    const config = cropConfigs[crop_type];
    if (!config) return res.status(400).json({ success: false, message: 'Invalid crop type selected!' });

    // Cek saldo user
    let { data: user, error: userErr } = await supabase.from('users').select('*').eq('id', user_id).single();
    if (userErr || !user) return res.status(404).json({ success: false, message: 'User not found!' });

    if (Number(user.coins) < config.cost) {
      return res.status(400).json({ success: false, message: `Insufficient Coins! Need ${config.cost} Coins for ${crop_type}.` });
    }

    // Cek status plot lahan user
    let { data: plot } = await supabase.from('user_plots')
      .select('*')
      .eq('user_id', user_id)
      .eq('plot_index', plot_index)
      .single();

    if (!plot || plot.status === 'LOCKED') {
      return res.status(400).json({ success: false, message: 'This plot is locked! Unlock it first.' });
    }
    if (plot.status === 'PLANTED') {
      return res.status(400).json({ success: false, message: 'This plot already has an active crop growing!' });
    }

    let harvestTime = new Date(Date.now() + config.durationMinutes * 60000).toISOString();

    // Potong koin user & update status plot
    await supabase.from('users').update({ coins: Number(user.coins) - config.cost }).eq('id', user_id);
    await supabase.from('user_plots').update({
      status: 'PLANTED',
      crop_type: crop_type,
      harvest_due_at: harvestTime
    }).eq('id', plot.id);

    await supabase.from('transactions').insert([{
      user_id,
      type: 'PLANT_CROP',
      amount: config.cost,
      currency_type: 'COINS',
      description: `Planted ${crop_type} on Plot #${plot_index} for ${config.cost} Coins.`
    }]);

    return res.status(200).json({ success: true, message: `Successfully planted ${crop_type}!` });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
}
