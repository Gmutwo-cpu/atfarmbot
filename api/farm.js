import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  try {
    const { action, user_id, telegram_id, plot_index, crop_type, boost_type } = req.body;
    // Mendukung identifikasi user_id atau telegram_id secara fleksibel
    const identifier = user_id || telegram_id;

    if (!identifier && action !== 'get_plots') {
      return res.status(400).json({ success: false, message: 'Missing user identifier!' });
    }

    // Ambil data user jika diperlukan
    let user = null;
    if (identifier) {
      let query = supabase.from('users').select('*');
      if (user_id) query = query.eq('id', user_id);
      else query = query.eq('telegram_id', telegram_id);
      let { data } = await query.single();
      user = data;
    }

    // 1. GET PLOTS
    if (action === 'get_plots') {
      let queryId = user_id || telegram_id;
      let { data: plots, error } = await supabase
        .from('user_plots')
        .select('*')
        .eq(user_id ? 'user_id' : 'telegram_id', queryId)
        .order('plot_index', { ascending: true });

      if (error) throw error;

      if (!plots || plots.length === 0) {
        const defaultPlots = [
          { [user_id ? 'user_id' : 'telegram_id']: queryId, plot_index: 1, status: 'EMPTY', crop_type: 'APPLE' },
          { [user_id ? 'user_id' : 'telegram_id']: queryId, plot_index: 2, status: 'LOCKED', crop_type: 'APPLE' },
          { [user_id ? 'user_id' : 'telegram_id']: queryId, plot_index: 3, status: 'LOCKED', crop_type: 'APPLE' },
          { [user_id ? 'user_id' : 'telegram_id']: queryId, plot_index: 4, status: 'LOCKED', crop_type: 'APPLE' }
        ];
        await supabase.from('user_plots').insert(defaultPlots);
        plots = defaultPlots;
      }
      return res.status(200).json({ success: true, plots });
    }

    // 2. UNLOCK PLOT
    if (action === 'unlock_plot') {
      const unlockCosts = { 2: 250, 3: 1000, 4: 5000 };
      const cost = unlockCosts[plot_index];
      if (!cost) return res.status(400).json({ success: false, message: 'Invalid plot index!' });

      if (Number(user.coins) < cost) {
        return res.status(400).json({ success: false, message: `Insufficient Coins! Plot #${plot_index} costs ${cost.toLocaleString()} Coins.` });
      }

      let matchKey = user_id ? 'id' : 'telegram_id';
      let matchVal = user_id || telegram_id;

      await supabase.from('users').update({ coins: Number(user.coins) - cost }).eq(matchKey, matchVal);
      await supabase.from('user_plots').update({ status: 'EMPTY' }).eq(matchKey, matchVal).eq('plot_index', plot_index);

      return res.status(200).json({ success: true, message: `Plot #${plot_index} unlocked successfully!` });
    }

    // 3. CLAIM DEV BONUS
    if (action === 'claim_dev_bonus') {
      const { data: existingNotice } = await supabase
        .from('completed_tasks')
        .select('*')
        .eq('telegram_id', telegram_id)
        .eq('task_id', 'dev_bonus')
        .single();

      if (existingNotice) {
        return res.status(400).json({ success: false, message: 'Bonus already claimed!' });
      }

      const newCoins = (user.coins || 0) + 15;
      await supabase.from('users').update({ coins: newCoins }).eq('telegram_id', telegram_id);
      await supabase.from('completed_tasks').insert([{ telegram_id, task_id: 'dev_bonus' }]);

      return res.status(200).json({ success: true, message: 'Successfully claimed 15 coins bonus!' });
    }

    // 4. PLANT CROP
    if (action === 'plant') {
      const cropConfigs = {
        'APPLE': { durationMinutes: 340, cost: 10 },
        'STRAWBERRY': { durationMinutes: 120, cost: 25 },
        'ORANGE': { durationMinutes: 600, cost: 60 }
      };

      const config = cropConfigs[crop_type];
      if (!config) return res.status(400).json({ success: false, message: 'Invalid crop type!' });

      if (Number(user.coins) < config.cost) {
        return res.status(400).json({ success: false, message: `Insufficient Coins! Need ${config.cost} Coins.` });
      }

      let matchKey = user_id ? 'user_id' : 'telegram_id';
      let matchVal = user_id || telegram_id;

      let { data: plot } = await supabase.from('user_plots').select('*').eq(matchKey, matchVal).eq('plot_index', plot_index).single();
      if (!plot || plot.status !== 'EMPTY') {
        return res.status(400).json({ success: false, message: 'Plot is not available for planting!' });
      }

      let harvestTime = new Date(Date.now() + config.durationMinutes * 60000).toISOString();
      let userMatchKey = user_id ? 'id' : 'telegram_id';
      let userMatchVal = user_id || telegram_id;

      await supabase.from('users').update({ coins: Number(user.coins) - config.cost }).eq(userMatchKey, userMatchVal);
      await supabase.from('user_plots').update({ status: 'PLANTED', crop_type, harvest_due_at: harvestTime }).eq('id', plot.id);

      return res.status(200).json({ success: true, message: `Successfully planted ${crop_type}!` });
    }

    // 5. HARVEST CROP
    if (action === 'harvest') {
      let matchKey = user_id ? 'user_id' : 'telegram_id';
      let matchVal = user_id || telegram_id;

      let { data: plot } = await supabase.from('user_plots').select('*').eq(matchKey, matchVal).eq('plot_index', plot_index).single();
      if (!plot || plot.status !== 'PLANTED') return res.status(400).json({ success: false, message: 'No active crop!' });
      if (new Date() < new Date(plot.harvest_due_at)) return res.status(400).json({ success: false, message: 'Crop is still growing!' });

      const fruitRewards = { 'APPLE': 1, 'STRAWBERRY': 2, 'ORANGE': 5 };
      let rewardFruits = fruitRewards[plot.crop_type] || 1;

      let { data: farm } = await supabase.from('farms').select('*').eq(matchKey, matchVal).single();
      let currentFruits = Number(farm.fruits || 0) + rewardFruits;

      await supabase.from('user_plots').update({ status: 'EMPTY', crop_type: 'APPLE', harvest_due_at: null }).eq('id', plot.id);
      await supabase.from('farms').update({ fruits: currentFruits }).eq(matchKey, matchVal);

      return res.status(200).json({ success: true, message: `Harvest successful! +${rewardFruits} fruits.` });
    }

    // 6. BOOST
    if (action === 'boost') {
      let matchKey = user_id ? 'user_id' : 'telegram_id';
      let matchVal = user_id || telegram_id;

      let { data: farm } = await supabase.from('farms').select('*').eq(matchKey, matchVal).single();
      if (!farm) return res.status(404).json({ success: false, message: 'Farm data not found!' });

      let updateData = {};
      if (boost_type === 'WATER' && farm.water > 0) {
        updateData.water = farm.water - 1;
      } else if (boost_type === 'FERTILIZER' && farm.fertilizer > 0) {
        updateData.fertilizer = farm.fertilizer - 1;
      } else {
        return res.status(400).json({ success: false, message: 'Insufficient boost items!' });
      }

      await supabase.from('farms').update(updateData).eq(matchKey, matchVal);
      return res.status(200).json({ success: true, message: `Successfully used ${boost_type} boost!` });
    }

    return res.status(400).json({ success: false, message: 'Invalid action type!' });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
}
