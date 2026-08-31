import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const { action, user_id } = req.body;
  if (!user_id || !action) {
    return res.status(400).json({ success: false, message: 'Missing user_id or action!' });
  }

  try {
    // 1. GET PLOTS (Menggantikan plots.js)
    if (action === 'get_plots') {
      let { data: plots, error } = await supabase
        .from('user_plots')
        .select('*')
        .eq('user_id', user_id)
        .order('plot_index', { ascending: true });

      if (error) throw error;

      if (!plots || plots.length === 0) {
        const defaultPlots = [
          { user_id, plot_index: 1, status: 'EMPTY', crop_type: 'APPLE' },
          { user_id, plot_index: 2, status: 'LOCKED', crop_type: 'APPLE' },
          { user_id, plot_index: 3, status: 'LOCKED', crop_type: 'APPLE' },
          { user_id, plot_index: 4, status: 'LOCKED', crop_type: 'APPLE' }
        ];
        await supabase.from('user_plots').insert(defaultPlots);
        plots = defaultPlots;
      }
      return res.status(200).json({ success: true, plots });
    }

    // 2. UNLOCK PLOT (Menggantikan unlock.js)
    if (action === 'unlock_plot') {
      const { plot_index } = req.body;
      const unlockCosts = { 2: 250, 3: 1000, 4: 5000 };
      const cost = unlockCosts[plot_index];
      if (!cost) return res.status(400).json({ success: false, message: 'Invalid plot index!' });

      let { data: user } = await supabase.from('users').select('*').eq('id', user_id).single();
      if (Number(user.coins) < cost) {
        return res.status(400).json({ success: false, message: `Insufficient Coins! Plot #${plot_index} costs ${cost.toLocaleString()} Coins.` });
      }

      await supabase.from('users').update({ coins: Number(user.coins) - cost }).eq('id', user_id);
      await supabase.from('user_plots').update({ status: 'EMPTY' }).eq('user_id', user_id).eq('plot_index', plot_index);

      return res.status(200).json({ success: true, message: `Plot #${plot_index} unlocked successfully!` });
    }

    // 3. PLANT CROP (Menggantikan plant.js)
    if (action === 'plant') {
      const { plot_index, crop_type } = req.body;
      const cropConfigs = {
        'APPLE': { durationMinutes: 340, cost: 10 },
        'STRAWBERRY': { durationMinutes: 120, cost: 25 },
        'ORANGE': { durationMinutes: 600, cost: 60 }
      };

      const config = cropConfigs[crop_type];
      if (!config) return res.status(400).json({ success: false, message: 'Invalid crop type!' });

      let { data: user } = await supabase.from('users').select('*').eq('id', user_id).single();
      if (Number(user.coins) < config.cost) {
        return res.status(400).json({ success: false, message: `Insufficient Coins! Need ${config.cost} Coins.` });
      }

      let { data: plot } = await supabase.from('user_plots').select('*').eq('user_id', user_id).eq('plot_index', plot_index).single();
      if (!plot || plot.status !== 'EMPTY') {
        return res.status(400).json({ success: false, message: 'Plot is not available for planting!' });
      }

      let harvestTime = new Date(Date.now() + config.durationMinutes * 60000).toISOString();
      await supabase.from('users').update({ coins: Number(user.coins) - config.cost }).eq('id', user_id);
      await supabase.from('user_plots').update({ status: 'PLANTED', crop_type, harvest_due_at: harvestTime }).eq('id', plot.id);

      await supabase.from('transactions').insert([{
        user_id, type: 'PLANT_CROP', amount: config.cost, currency_type: 'COINS', description: `Planted ${crop_type} on Plot #${plot_index}`
      }]);

      return res.status(200).json({ success: true, message: `Successfully planted ${crop_type}!` });
    }

    // 4. HARVEST CROP (Menggantikan harvest.js)
    if (action === 'harvest') {
      const { plot_index } = req.body;
      let { data: plot } = await supabase.from('user_plots').select('*').eq('user_id', user_id).eq('plot_index', plot_index).single();
      
      if (!plot || plot.status !== 'PLANTED') return res.status(400).json({ success: false, message: 'No active crop!' });
      if (new Date() < new Date(plot.harvest_due_at)) return res.status(400).json({ success: false, message: 'Crop is still growing!' });

      const fruitRewards = { 'APPLE': 1, 'STRAWBERRY': 2, 'ORANGE': 5 };
      let rewardFruits = fruitRewards[plot.crop_type] || 1;

      let { data: farm } = await supabase.from('farms').select('*').eq('user_id', user_id).single();
      let currentFruits = Number(farm.fruits || 0) + rewardFruits;

      await supabase.from('user_plots').update({ status: 'EMPTY', crop_type: 'APPLE', harvest_due_at: null }).eq('id', plot.id);
      await supabase.from('farms').update({ fruits: currentFruits }).eq('user_id', user_id);

      await supabase.from('transactions').insert([{
        user_id, type: 'HARVEST', description: `Harvested ${rewardFruits}x fruits from ${plot.crop_type}`
      }]);

      return res.status(200).json({ success: true, message: `Harvest successful! +${rewardFruits} fruits.` });
    }

    // 5. BOOST & GENERAL ACTIONS (Menggantikan boost.js & action.js jika diperlukan)
    if (action === 'boost') {
      const { boost_type } = req.body;
      // Logika booster air/pupuk
      let { data: farm } = await supabase.from('farms').select('*').eq('user_id', user_id).single();
      let updateData = {};
      
      if (boost_type === 'WATER' && farm.water > 0) {
        updateData.water = farm.water - 1;
      } else if (boost_type === 'FERTILIZER' && farm.fertilizer > 0) {
        updateData.fertilizer = farm.fertilizer - 1;
      } else {
        return res.status(400).json({ success: false, message: 'Insufficient boost items!' });
      }

      await supabase.from('farms').update(updateData).eq('user_id', user_id);
      return res.status(200).json({ success: true, message: `Successfully used ${boost_type} boost!` });
    }

    return res.status(400).json({ success: false, message: 'Invalid action type!' });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
}
