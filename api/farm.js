import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const { action, user_id, telegram_id, plot_index, crop_type, boost_type } = req.body;
  const targetUserId = user_id || telegram_id;

  if (!targetUserId) {
    return res.status(400).json({ success: false, error: 'Missing user ID!' });
  }

  const userIdStr = String(targetUserId);
  const now = new Date();

  try {
    // 1. GET PLOTS
    if (action === 'get_plots') {
      let { data: plots, error } = await supabase
        .from('farming_plots')
        .select('*')
        .eq('user_id', userIdStr)
        .order('plot_index', { ascending: true });

      if (error) throw error;
      return res.status(200).json({ success: true, plots: plots || [] });
    }

    // 2. UNLOCK PLOT
    if (action === 'unlock_plot') {
      const costs = { 2: 250, 3: 1000, 4: 5000 };
      const cost = costs[plot_index];
      if (!cost) return res.status(400).json({ success: false, error: 'Invalid plot index.' });

      let { data: user } = await supabase.from('users').select('coins').eq('id', userIdStr).single();
      if (!user || Number(user.coins) < cost) {
        return res.status(400).json({ success: false, error: 'Insufficient coins to unlock this plot!' });
      }

      let { data: existingPlot } = await supabase
        .from('farming_plots')
        .select('*')
        .eq('user_id', userIdStr)
        .eq('plot_index', plot_index)
        .maybeSingle();

      if (existingPlot && existingPlot.status !== 'LOCKED') {
        return res.status(400).json({ success: false, error: 'Plot is already unlocked.' });
      }

      await supabase.from('users').update({ coins: Number(user.coins) - cost }).eq('id', userIdStr);

      if (existingPlot) {
        await supabase.from('farming_plots').update({ status: 'EMPTY', updated_at: now }).eq('id', existingPlot.id);
      } else {
        await supabase.from('farming_plots').insert([{
          user_id: userIdStr,
          plot_index,
          status: 'EMPTY',
          updated_at: now
        }]);
      }

      return res.status(200).json({ success: true, message: `Successfully unlocked Plot #${plot_index}!` });
    }

    // 3. PLANT CROP
    if (action === 'plant') {
      const cropConfig = {
        'APPLE': { cost: 10, durationHours: 5.66 },
        'STRAWBERRY': { cost: 34, durationHours: 2.33 },
        'ORANGE': { cost: 60, durationHours: 10.0 }
      };

      const crop = cropConfig[crop_type];
      if (!crop) return res.status(400).json({ success: false, error: 'Invalid crop type.' });

      let { data: user } = await supabase.from('users').select('coins').eq('id', userIdStr).single();
      if (!user || Number(user.coins) < crop.cost) {
        return res.status(400).json({ success: false, error: 'Insufficient coins to buy this seed!' });
      }

      let { data: plot } = await supabase
        .from('farming_plots')
        .select('*')
        .eq('user_id', userIdStr)
        .eq('plot_index', plot_index)
        .single();

      if (!plot || plot.status !== 'EMPTY') {
        return res.status(400).json({ success: false, error: 'Plot is not available for planting.' });
      }

      const dueTime = new Date(now.getTime() + crop.durationHours * 3600 * 1000);

      await supabase.from('users').update({ coins: Number(user.coins) - crop.cost }).eq('id', userIdStr);
      await supabase.from('farming_plots').update({
        status: 'PLANTED',
        crop_type,
        harvest_due_at: dueTime,
        updated_at: now
      }).eq('id', plot.id);

      return res.status(200).json({ success: true, message: `Successfully planted ${crop_type} on Plot #${plot_index}!` });
    }

    // 4. HARVEST CROP
    if (action === 'harvest') {
      let { data: plot } = await supabase
        .from('farming_plots')
        .select('*')
        .eq('user_id', userIdStr)
        .eq('plot_index', plot_index)
        .single();

      if (!plot || plot.status !== 'PLANTED') {
        return res.status(400).json({ success: false, error: 'No active crop to harvest on this plot.' });
      }

      if (new Date() < new Date(plot.harvest_due_at)) {
        return res.status(400).json({ success: false, error: 'Crop is still growing!' });
      }

      let rewardFruits = plot.crop_type === 'STRAWBERRY' ? 2 : (plot.crop_type === 'ORANGE' ? 5 : 1);

      let { data: farm } = await supabase.from('user_farms').select('*').eq('user_id', userIdStr).single();
      let currentFruits = farm ? (farm.fruits || 0) : 0;

      await supabase.from('user_farms').update({
        fruits: currentFruits + rewardFruits,
        updated_at: now
      }).eq('user_id', userIdStr);

      await supabase.from('farming_plots').update({
        status: 'EMPTY',
        crop_type: null,
        harvest_due_at: null,
        updated_at: now
      }).eq('id', plot.id);

      return res.status(200).json({ success: true, message: `Successfully harvested +${rewardFruits} fruits!` });
    }

    // 5. BOOST CROP (WATER / FERTILIZER)
    if (action === 'boost') {
      let { data: farm } = await supabase
        .from('user_farms')
        .select('*')
        .eq('user_id', userIdStr)
        .single();

      if (!farm) {
        return res.status(400).json({ success: false, error: 'Farm inventory not found!' });
      }

      let currentWater = farm.water || 0;
      let currentFert = farm.fertilizer || 0;

      if (boost_type === 'WATER') {
        if (currentWater <= 0) {
          return res.status(400).json({ success: false, error: 'Not enough Water Supply!' });
        }
      } else if (boost_type === 'FERTILIZER') {
        if (currentFert <= 0) {
          return res.status(400).json({ success: false, error: 'Not enough Fertilizer Supply!' });
        }
      } else {
        return res.status(400).json({ success: false, error: 'Invalid boost type.' });
      }

      let { data: plot } = await supabase
        .from('farming_plots')
        .select('*')
        .eq('user_id', userIdStr)
        .eq('plot_index', plot_index)
        .single();

      if (!plot || plot.status !== 'PLANTED') {
        return res.status(400).json({ success: false, error: 'No active growing crop on this plot to boost.' });
      }

      let currentDue = new Date(plot.harvest_due_at).getTime();
      let reductionMs = boost_type === 'WATER' ? 30 * 60 * 1000 : 60 * 60 * 1000; // Water = -30m, Fert = -60m
      let newDue = new Date(Math.max(now.getTime(), currentDue - reductionMs));

      // Kurangi stok suplai di user_farms
      let updateFarmData = { updated_at: now };
      if (boost_type === 'WATER') updateFarmData.water = currentWater - 1;
      if (boost_type === 'FERTILIZER') updateFarmData.fertilizer = currentFert - 1;

      await supabase.from('user_farms').update(updateFarmData).eq('user_id', userIdStr);
      await supabase.from('farming_plots').update({ harvest_due_at: newDue, updated_at: now }).eq('id', plot.id);

      return res.status(200).json({ 
        success: true, 
        message: `Successfully applied ${boost_type} boost! Growth time reduced.` 
      });
    }

    return res.status(400).json({ success: false, error: 'Invalid farm action.' });

  } catch (err) {
    return res.status(500).json({ success: false, error: 'Server error: ' + err.message });
  }
}
