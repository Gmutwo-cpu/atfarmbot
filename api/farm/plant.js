import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  try {
    const { user_id, plot_index, crop_type } = req.body;
    if (!user_id || plot_index === undefined || !crop_type) {
      return res.status(400).json({ success: false, message: 'Missing parameters!' });
    }

    // Konfigurasi Durasi & Hasil Berdasarkan Jenis Tanaman
    const cropConfigs = {
      'APPLE': { durationMinutes: 340, seedCost: 10 },      // 5 jam 40 min
      'STRAWBERRY': { durationMinutes: 180, seedCost: 25 }, // 3 jam
      'COFFEE': { durationMinutes: 600, seedCost: 60 }      // 10 jam
    };

    const config = cropConfigs[crop_type];
    if (!config) return res.status(400).json({ success: false, message: 'Invalid crop type!' });

    // Cek data user & koin/benih
    let { data: user } = await supabase.from('users').select('*').eq('telegram_id', user_id).single();
    if (!user) return res.status(404).json({ success: false, message: 'User not found!' });

    if (Number(user.coins) < config.seedCost) {
      return res.status(400).json({ success: false, message: `Insufficient coins! Need ${config.seedCost} Coins.` });
    }

    // Cek status lahan (plot) tertentu
    let { data: plot } = await supabase.from('user_plots')
      .select('*')
      .eq('telegram_id', user_id)
      .eq('plot_index', plot_index)
      .single();

    if (plot && plot.is_planted) {
      return res.status(400).json({ success: false, message: 'This plot is already planted!' });
    }

    let harvestTime = new Date(Date.now() + config.durationMinutes * 60000).toISOString();

    if (plot) {
      await supabase.from('user_plots').update({
        crop_type: crop_type,
        is_planted: true,
        harvest_due_at: harvestTime
      }).eq('id', plot.id);
    } else {
      await supabase.from('user_plots').insert([{
        telegram_id: user_id,
        plot_index: plot_index,
        crop_type: crop_type,
        is_planted: true,
        harvest_due_at: harvestTime
      }]);
    }

    // Kurangi koin user
    await supabase.from('users').update({ coins: Number(user.coins) - config.seedCost }).eq('telegram_id', user_id);

    return res.status(200).json({ success: true, message: `Successfully planted ${crop_type}!` });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
}
