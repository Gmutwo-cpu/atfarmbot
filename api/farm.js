import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const { action, user_id, plot_index } = req.body;

  if (!user_id) {
    return res.status(400).json({ success: false, message: 'Missing user_id!' });
  }

  const userIdStr = String(user_id);
  const now = new Date();

  try {
    // 1. GET PLOTS & USER INVENTORY
    if (action === 'get_plots') {
      let { data: farm, error: farmErr } = await supabase
        .from('user_farms')
        .select('*')
        .eq('user_id', userIdStr)
        .single();

      if (farmErr || !farm) {
        return res.status(404).json({ success: false, message: 'Farm data not found!' });
      }

      let plots = farm.plots;
      if (!plots || !Array.isArray(plots) || plots.length === 0) {
        plots = [
          { index: 0, unlocked: true, status: 'empty', planted_at: null, harvest_at: null },
          { index: 1, unlocked: false, status: 'locked', planted_at: null, harvest_at: null },
          { index: 2, unlocked: false, status: 'locked', planted_at: null, harvest_at: null },
          { index: 3, unlocked: false, status: 'locked', planted_at: null, harvest_at: null }
        ];
        await supabase.from('user_farms').update({ plots, updated_at: now }).eq('user_id', userIdStr);
      }

      return res.status(200).json({
        success: true,
        plots: plots,
        seeds: farm.seeds || 0,
        water: farm.water || 0,
        fertilizer: farm.fertilizer || 0,
        fruits: farm.fruits || 0
      });
    }

    // 2. UNLOCK PLOT
    if (action === 'unlock_plot') {
      let { data: farm } = await supabase.from('user_farms').select('*').eq('user_id', userIdStr).single();
      let { data: user } = await supabase.from('users').select('*').eq('id', userIdStr).single();

      if (!farm || !user) return res.status(404).json({ success: false, message: 'Data not found!' });

      let plots = farm.plots || [];
      const targetPlot = plots.find(p => p.index === Number(plot_index));

      if (!targetPlot) return res.status(400).json({ success: false, message: 'Invalid plot index!' });
      if (targetPlot.unlocked) return res.status(400).json({ success: false, message: 'Plot is already unlocked!' });

      const unlockCost = 100 * Number(plot_index); // Plot 1: 100, Plot 2: 200, Plot 3: 300 Coins
      if (Number(user.coins) < unlockCost) {
        return res.status(400).json({ success: false, message: `Insufficient Coins! Need ${unlockCost} Coins to unlock.` });
      }

      targetPlot.unlocked = true;
      targetPlot.status = 'empty';

      await supabase.from('users').update({ coins: Number(user.coins) - unlockCost, updated_at: now }).eq('id', userIdStr);
      await supabase.from('user_farms').update({ plots, updated_at: now }).eq('user_id', userIdStr);

      await supabase.from('transactions').insert([{
        user_id: userIdStr,
        type: 'UNLOCK_PLOT',
        amount: unlockCost,
        currency_type: 'COINS',
        description: `Unlocked Farming Plot #${plot_index}`,
        created_at: now
      }]);

      return res.status(200).json({ success: true, message: `Successfully unlocked Plot #${plot_index}!` });
    }

    // 3. PLANT SEED
    if (action === 'plant') {
      let { data: farm } = await supabase.from('user_farms').select('*').eq('user_id', userIdStr).single();
      if (!farm) return res.status(404).json({ success: false, message: 'Farm not found!' });

      if ((farm.seeds || 0) < 1) {
        return res.status(400).json({ success: false, message: 'No seeds available! Please buy seeds from the Market.' });
      }

      let plots = farm.plots || [];
      const targetPlot = plots.find(p => p.index === Number(plot_index));

      if (!targetPlot || !targetPlot.unlocked) return res.status(400).json({ success: false, message: 'Plot is locked or invalid!' });
      if (targetPlot.status !== 'empty') return res.status(400).json({ success: false, message: 'Plot is already occupied!' });

      const harvestDurationMs = 60 * 1000; // 1 Menit durasi tumbuh (bisa disesuaikan)
      targetPlot.status = 'growing';
      targetPlot.planted_at = now.toISOString();
      targetPlot.harvest_at = new Date(now.getTime() + harvestDurationMs).toISOString();

      await supabase.from('user_farms').update({
        seeds: farm.seeds - 1,
        plots,
        updated_at: now
      }).eq('user_id', userIdStr);

      return res.status(200).json({ success: true, message: 'Successfully planted seed!' });
    }

    // 4. HARVEST FRUITS (DENGAN INTEGRASI VALIDASI REFERRAL OTOMATIS)
    if (action === 'harvest') {
      let { data: farm } = await supabase.from('user_farms').select('*').eq('user_id', userIdStr).single();
      let { data: user } = await supabase.from('users').select('*').eq('id', userIdStr).single();

      if (!farm || !user) return res.status(404).json({ success: false, message: 'Data not found!' });

      let plots = farm.plots || [];
      const targetPlot = plots.find(p => p.index === Number(plot_index));

      if (!targetPlot || targetPlot.status !== 'growing') {
        return res.status(400).json({ success: false, message: 'Nothing to harvest here!' });
      }

      if (new Date() < new Date(targetPlot.harvest_at)) {
        return res.status(400).json({ success: false, message: 'Crop is still growing!' });
      }

      // Reset plot jadi empty
      targetPlot.status = 'empty';
      targetPlot.planted_at = null;
      targetPlot.harvest_at = null;

      const earnedFruits = (farm.fruits || 0) + 1;

      await supabase.from('user_farms').update({
        fruits: earnedFruits,
        plots,
        updated_at: now
      }).eq('user_id', userIdStr);

      // --- INTEGRASI VALIDASI REFERRAL OTOMATIS ---
      // Jika user berstatus PENDING dan memiliki pengajak (referred_by), ubah jadi ACTIVE dan beri reward inviter
      if (user.referral_status === 'PENDING' && user.referred_by) {
        await supabase.from('users').update({ referral_status: 'ACTIVE', updated_at: now }).eq('id', userIdStr);

        let { data: inviter } = await supabase.from('users').select('*').eq('id', user.referred_by).maybeSingle();
        if (inviter) {
          const updatedInviterCoins = Number(inviter.coins || 0) + 50.00;
          const updatedInviterAtf = Number(inviter.atf_balance || 0) + 1.0000;
          const updatedInviterPoints = Number(inviter.points || 0) + 1;

          await supabase.from('users').update({
            coins: updatedInviterCoins,
            atf_balance: updatedInviterAtf,
            points: updatedInviterPoints,
            updated_at: now
          }).eq('id', inviter.id);

          await supabase.from('transactions').insert([{
            user_id: inviter.id,
            type: 'REFERRAL_BONUS',
            amount: 1.0000,
            currency_type: 'ATF',
            description: `Referral reward from @${user.username || user.first_name}: +1 ATF, +1 Point, +50 Coins`,
            created_at: now
          }]);
        }
      }
      // -------------------------------------------

      return res.status(200).json({ success: true, message: 'Successfully harvested fruit!' });
    }

    // 5. USE BOOST / WATER / FERTILIZER
    if (action === 'boost') {
      let { data: farm } = await supabase.from('user_farms').select('*').eq('user_id', userIdStr).single();
      if (!farm) return res.status(404).json({ success: false, message: 'Farm not found!' });

      let plots = farm.plots || [];
      const targetPlot = plots.find(p => p.index === Number(plot_index));

      if (!targetPlot || targetPlot.status !== 'growing') {
        return res.status(400).json({ success: false, message: 'No active crop to boost!' });
      }

      if ((farm.water || 0) < 1) {
        return res.status(400).json({ success: false, message: 'No water available! Buy water from Market.' });
      }

      // Kurangi waktu panen instan (percepat selesai)
      targetPlot.harvest_at = new Date().toISOString();

      await supabase.from('user_farms').update({
        water: farm.water - 1,
        plots,
        updated_at: now
      }).eq('user_id', userIdStr);

      return res.status(200).json({ success: true, message: 'Crop boosted successfully! Ready to harvest.' });
    }

    return res.status(400).json({ success: false, message: 'Invalid farm action.' });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Exception: ' + err.message });
  }
}
