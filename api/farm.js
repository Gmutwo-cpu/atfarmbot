import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  try {
    const { action, user_id, telegram_id, plot_index, crop_type, boost_type } = req.body;
    const identifier = user_id || telegram_id;

    if (!identifier && action !== 'get_plots') {
      return res.status(400).json({ success: false, message: 'Missing user identifier!' });
    }

    // Ambil data user secara aman berdasarkan id atau telegram_id
    let user = null;
    if (identifier) {
      let { data } = await supabase.from('users').select('*').eq('id', identifier).single();
      if (!data) {
        let { data: dataTg } = await supabase.from('users').select('*').eq('telegram_id', identifier).single();
        user = dataTg;
      } else {
        user = data;
      }
    }

    // 1. GET PLOTS
    if (action === 'get_plots') {
      let queryId = identifier;
      let { data: plots, error } = await supabase
        .from('user_plots')
        .select('*')
        .eq('user_id', queryId)
        .order('plot_index', { ascending: true });

      if (error) throw error;

      if (!plots || plots.length === 0) {
        const defaultPlots = [
          { user_id: queryId, plot_index: 1, status: 'EMPTY', crop_type: 'APPLE' },
          { user_id: queryId, plot_index: 2, status: 'LOCKED', crop_type: 'APPLE' },
          { user_id: queryId, plot_index: 3, status: 'LOCKED', crop_type: 'APPLE' },
          { user_id: queryId, plot_index: 4, status: 'LOCKED', crop_type: 'APPLE' }
        ];
        await supabase.from('user_plots').insert(defaultPlots);
        plots = defaultPlots;
      }
      return res.status(200).json({ success: true, plots });
    }

    // 2. UNLOCK PLOT
    if (action === 'unlock_plot') {
      if (!user) return res.status(404).json({ success: false, message: 'User not found!' });
      const unlockCosts = { 2: 250, 3: 1000, 4: 5000 };
      const cost = unlockCosts[plot_index];
      if (!cost) return res.status(400).json({ success: false, message: 'Invalid plot index!' });

      if (Number(user.coins) < cost) {
        return res.status(400).json({ success: false, message: `Insufficient Coins! Plot #${plot_index} costs ${cost.toLocaleString()} Coins.` });
      }

      await supabase.from('users').update({ coins: Number(user.coins) - cost }).eq('id', user.id);
      await supabase.from('user_plots').update({ status: 'EMPTY' }).eq('user_id', user.id).eq('plot_index', plot_index);

      return res.status(200).json({ success: true, message: `Plot #${plot_index} unlocked successfully!` });
    }

    // 3. CLAIM DEV BONUS (Diperbaiki agar aman dari error null user & konsisten dengan tabel users)
    if (action === 'claim_dev_bonus') {
      if (!user) {
        return res.status(404).json({ success: false, message: 'User record not initialized. Please refresh mini app.' });
      }

      const { data: existingNotice } = await supabase
        .from('completed_tasks')
        .select('*')
        .eq('user_id', user.id)
        .eq('task_id', 'dev_bonus')
        .single();

      if (existingNotice) {
        return res.status(400).json({ success: false, message: 'Bonus already claimed!' });
      }

      const newCoins = Number(user.coins || 0) + 15;
      await supabase.from('users').update({ coins: newCoins }).eq('id', user.id);
      await supabase.from('completed_tasks').insert([{ user_id: user.id, task_id: 'dev_bonus' }]);

      return res.status(200).json({ success: true, message: 'Successfully claimed 15 coins bonus!' });
    }

    // 4. PLANT CROP
    if (action === 'plant') {
      if (!user) return res.status(404).json({ success: false, message: 'User not found!' });
      const cropConfigs = {
        'APPLE': { durationMinutes: 340, cost: 10 },
        'STRAWBERRY': { durationMinutes: 120, cost: 25 },
        'ORANGE': { durationMinutes: 600, cost: 60 }
      };

      const targetCrop = crop_type || 'APPLE';
      const config = cropConfigs[targetCrop];
      if (!config) return res.status(400).json({ success: false, message: 'Invalid crop type!' });

      if (Number(user.coins) < config.cost) {
        return res.status(400).json({ success: false, message: `Insufficient Coins! Need ${config.cost} Coins.` });
      }

      let targetPlotIdx = plot_index || 1;
      let { data: plot } = await supabase.from('user_plots').select('*').eq('user_id', user.id).eq('plot_index', targetPlotIdx).single();
      if (!plot || plot.status !== 'EMPTY') {
        return res.status(400).json({ success: false, message: 'Plot is not available for planting!' });
      }

      let harvestTime = new Date(Date.now() + config.durationMinutes * 60000).toISOString();

      await supabase.from('users').update({ coins: Number(user.coins) - config.cost }).eq('id', user.id);
      await supabase.from('user_plots').update({ status: 'PLANTED', crop_type: targetCrop, harvest_due_at: harvestTime }).eq('id', plot.id);

      await supabase.from('transactions').insert([{
        user_id: user.id,
        type: 'PLANT_CROP',
        amount: config.cost,
        currency_type: 'COINS',
        description: `Planted ${targetCrop} on Plot #${targetPlotIdx} for ${config.cost} Coins.`
      }]);

      return res.status(200).json({ success: true, message: `Successfully planted ${targetCrop}!` });
    }

    // 5. HARVEST CROP
    if (action === 'harvest') {
      if (!user) return res.status(404).json({ success: false, message: 'User not found!' });
      let targetPlotIdx = plot_index || 1;

      let { data: plot } = await supabase.from('user_plots').select('*').eq('user_id', user.id).eq('plot_index', targetPlotIdx).single();
      if (!plot || plot.status !== 'PLANTED') return res.status(400).json({ success: false, message: 'No active crop!' });
      if (new Date() < new Date(plot.harvest_due_at)) return res.status(400).json({ success: false, message: 'Crop is still growing!' });

      const fruitRewards = { 'APPLE': 1, 'STRAWBERRY': 2, 'ORANGE': 5 };
      let rewardFruits = fruitRewards[plot.crop_type] || 1;

      let { data: farm } = await supabase.from('farms').select('*').eq('user_id', user.id).single();
      let currentFruits = Number(farm.fruits || 0) + rewardFruits;

      await supabase.from('user_plots').update({ status: 'EMPTY', crop_type: 'APPLE', harvest_due_at: null }).eq('id', plot.id);
      await supabase.from('farms').update({ fruits: currentFruits }).eq('user_id', user.id);

      await supabase.from('transactions').insert([{
        user_id: user.id,
        type: 'HARVEST',
        description: `Harvested ${rewardFruits}x fruits from ${plot.crop_type} (Plot #${targetPlotIdx}).`
      }]);

      return res.status(200).json({ success: true, message: `Harvest successful! +${rewardFruits} fruits.` });
    }

    // 6. BOOST
    if (action === 'boost') {
      if (!user) return res.status(404).json({ success: false, message: 'User not found!' });
      let { data: farm } = await supabase.from('farms').select('*').eq('user_id', user.id).single();
      if (!farm) return res.status(404).json({ success: false, message: 'Farm data not found!' });

      let { data: plot } = await supabase.from('user_plots').select('*').eq('user_id', user.id).eq('status', 'PLANTED').order('plot_index').limit(1).single();
      if (!plot) return res.status(400).json({ success: false, message: 'No active plant to boost!' });

      let currentDueTime = new Date(plot.harvest_due_at).getTime();
      let reductionMs = 0;
      let updateFarm = {};

      if (boost_type === 'WATER') {
        if (farm.water < 1) return res.status(400).json({ success: false, message: 'Not enough Water Supply!' });
        reductionMs = 30 * 60 * 1000;
        updateFarm.water = farm.water - 1;
      } else if (boost_type === 'FERTILIZER') {
        if (farm.fertilizer < 1) return res.status(400).json({ success: false, message: 'Not enough Fertilizer!' });
        reductionMs = 60 * 60 * 1000;
        updateFarm.fertilizer = farm.fertilizer - 1;
      } else {
        return res.status(400).json({ success: false, message: 'Invalid boost type!' });
      }

      let newDueTime = Math.max(Date.now(), currentDueTime - reductionMs);
      await supabase.from('farms').update(updateFarm).eq('user_id', user.id);
      await supabase.from('user_plots').update({ harvest_due_at: new Date(newDueTime).toISOString() }).eq('id', plot.id);

      return res.status(200).json({ success: true, message: `Successfully applied ${boost_type} booster!` });
    }

    return res.status(400).json({ success: false, message: 'Invalid action type!' });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
}
