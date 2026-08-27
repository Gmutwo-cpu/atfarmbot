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

    const todayStr = new Date().toISOString().split('T')[0];

    // 1. Claim Dev Bonus (1x per hari)
    if (action === 'claim_dev_bonus') {
      if (user.last_claim_date === todayStr) {
        return res.status(400).json({ error: 'Bonus already claimed today! Come back tomorrow.' });
      }

      const newCoins = (user.coins || 0) + 15;
      const { data: updatedUser } = await supabase
        .from('users')
        .update({ coins: newCoins, last_claim_date: todayStr })
        .eq('telegram_id', telegram_id)
        .select()
        .single();

      return res.status(200).json({ success: true, user: updatedUser, message: 'Successfully claimed 15 coins bonus!' });
    }

    // 2. Unlock Plot
    if (action === 'unlock_plot') {
      const costs = { 2: 150, 3: 400, 4: 1000 };
      const cost = costs[plot_index];
      if (!cost) return res.status(400).json({ error: 'Invalid plot index' });

      if (user.coins < cost) {
        return res.status(400).json({ error: `Not enough coins! Plot #${plot_index} costs ${cost} Coins.` });
      }

      await supabase.from('users').update({ coins: user.coins - cost }).eq('telegram_id', telegram_id);
      await supabase.from('plots')
        .update({ status: 'empty' })
        .eq('telegram_id', telegram_id)
        .eq('plot_index', plot_index);

      const { data: updatedUser } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
      const { data: plots } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).order('plot_index');

      return res.status(200).json({ success: true, user: updatedUser, plots, message: `Plot #${plot_index} unlocked successfully!` });
    }

    // 3. Plant Seed
    if (action === 'plant') {
      if ((user.seed_inventory || 0) <= 0) {
        return res.status(400).json({ error: 'No seeds available! Buy seeds in the Market.' });
      }

      const { data: plot } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).eq('plot_index', plot_index).single();
      if (!plot || plot.status !== 'empty') {
        return res.status(400).json({ error: 'Plot is not available for planting.' });
      }

      const harvestTime = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 menit siklus panen

      await supabase.from('users').update({ seed_inventory: user.seed_inventory - 1 }).eq('telegram_id', telegram_id);
      await supabase.from('plots').update({ status: 'growing', harvest_at: harvestTime }).eq('telegram_id', telegram_id).eq('plot_index', plot_index);

      const { data: updatedUser } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
      const { data: plots } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).order('plot_index');

      return res.status(200).json({ success: true, user: updatedUser, plots, message: 'Seed planted successfully!' });
    }

    // 4. Harvest Crop
    if (action === 'harvest') {
      const { data: plot } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).eq('plot_index', plot_index).single();
      if (!plot || plot.status !== 'growing') {
        return res.status(400).json({ error: 'No active crop to harvest.' });
      }

      const now = new Date();
      const harvestTime = new Date(plot.harvest_at);

      if (now < harvestTime) {
        return res.status(400).json({ error: 'Crop is still growing! Please wait.' });
      }

      await supabase.from('users').update({ fruit_inventory: (user.fruit_inventory || 0) + 1 }).eq('telegram_id', telegram_id);
      await supabase.from('plots').update({ status: 'empty', harvest_at: null }).eq('telegram_id', telegram_id).eq('plot_index', plot_index);

      const { data: updatedUser } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
      const { data: plots } = await supabase.from('plots').select('*').eq('telegram_id', telegram_id).order('plot_index');

      return res.status(200).json({ success: true, user: updatedUser, plots, message: 'Successfully harvested 1 Fruit!' });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: 'Server Error: ' + err.message });
  }
};
