const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { telegram_id, action, plot_index } = req.body;
    let { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    if (!user) return res.status(404).json({ error: 'User not found' });

    // 1. Klaim Bonus Harian
    if (action === 'claim_dev_bonus') {
      const todayStr = new Date().toISOString().split('T')[0];
      if (user.last_claim_date === todayStr) {
        return res.status(400).json({ error: 'Bonus already claimed today!' });
      }

      const newCoins = (user.coins || 0) + 15;
      await supabase.from('users').update({ coins: newCoins, last_claim_date: todayStr }).eq('telegram_id', telegram_id);
      
      const { data: updatedUser } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
      return res.status(200).json({ success: true, message: 'Successfully claimed +15 Coins!', user: updatedUser });
    }

    // 2. Membuka Plot (Unlock Plot)
    if (action === 'unlock_plot') {
      const costs = { 1: 250, 2: 450, 3: 1000 };
      const cost = costs[plot_index];
      if (!cost) return res.status(400).json({ error: 'Invalid plot index' });

      if ((user.coins || 0) < cost) {
        return res.status(400).json({ error: 'Not enough coins to unlock this plot!' });
      }

      const { data: plot } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).eq('plot_index', plot_index).single();
      if (!plot || plot.status !== 'locked') {
        return res.status(400).json({ error: 'Plot is already unlocked.' });
      }

      await supabase.from('users').update({ coins: user.coins - cost }).eq('telegram_id', telegram_id);
      await supabase.from('plots').update({ status: 'empty' }).eq('telegram_id', telegram_id).eq('plot_index', plot_index);

      const { data: updatedUser } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
      const { data: plots } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).order('plot_index');

      return res.status(200).json({ success: true, message: `Plot #${plot_index} unlocked successfully!`, user: updatedUser, plots });
    }

    // 3. Boost Menggunakan Air (Water)
    if (action === 'boost_water') {
      if ((user.water_inventory || 0) <= 0) {
        return res.status(400).json({ error: 'No water supply available in inventory!' });
      }

      const { data: plot } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).eq('plot_index', plot_index).single();
      if (!plot || plot.status !== 'growing') {
        return res.status(400).json({ error: 'No growing crop to water.' });
      }

      // Mengurangi waktu panen sebanyak 1 menit
      const currentHarvestTime = new Date(plot.harvest_time).getTime();
      const newHarvestTime = new Date(currentHarvestTime - 60 * 1000).toISOString();

      await supabase.from('users').update({ water_inventory: user.water_inventory - 1 }).eq('telegram_id', telegram_id);
      await supabase.from('plots').update({ harvest_time: newHarvestTime }).eq('telegram_id', telegram_id).eq('plot_index', plot_index);

      const { data: updatedUser } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
      const { data: plots } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).order('plot_index');

      return res.status(200).json({ success: true, message: 'Watered crop! Harvest time reduced by 1 minute.', user: updatedUser, plots });
    }

    return res.status(400).json({ error: 'Unknown action command' });
  } catch (err) {
    return res.status(500).json({ error: 'Server Error: ' + err.message });
  }
};
