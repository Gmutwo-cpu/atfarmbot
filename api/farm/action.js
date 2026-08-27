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

    if (action === 'claim_dev_bonus') {
      const { data: existingNotice } = await supabase
        .from('completed_tasks')
        .select('*')
        .eq('telegram_id', telegram_id)
        .eq('task_id', 'dev_bonus')
        .single();

      if (existingNotice) {
        return res.status(400).json({ error: 'Bonus already claimed!' });
      }

      // Berikan 15 koin sesuai permintaan
      const newCoins = (user.coins || 0) + 15;
      const { data: updatedUser } = await supabase
        .from('users')
        .update({ coins: newCoins })
        .eq('telegram_id', telegram_id)
        .select()
        .single();

      await supabase.from('completed_tasks').insert([{ telegram_id, task_id: 'dev_bonus' }]);

      return res.status(200).json({ success: true, user: updatedUser, message: 'Successfully claimed 15 coins bonus!' });
    }

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

    return res.status(400).json({ error: 'Unknown farm action' });
  } catch (err) {
    return res.status(500).json({ error: 'Server Error: ' + err.message });
  }
};
