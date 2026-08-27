const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { telegram_id, task_code, reward_coins } = req.body;
    let { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Cek apakah task sudah pernah diselesaikan
    const { data: existing } = await supabase.from('completed_tasks').select('*').eq('telegram_id', telegram_id).eq('task_code', task_code).single();
    if (existing) {
      return res.status(400).json({ error: 'Task already completed!' });
    }

    // Catat task selesai & berikan koin
    await supabase.from('completed_tasks').insert([{ telegram_id, task_code, reward_coins: reward_coins || 50 }]);
    await supabase.from('users').update({ coins: (user.coins || 0) + (reward_coins || 50) }).eq('telegram_id', telegram_id);

    const { data: updatedUser } = await supabase.from('users').select('*').eq('telegram_id', telegram_id).single();
    const { data: completed_tasks } = await supabase.from('completed_tasks').select('*').eq('telegram_id', telegram_id);

    return res.status(200).json({ success: true, message: `Task completed! Reward +${reward_coins || 50} coins`, user: updatedUser, completed_tasks });
  } catch (err) {
    return res.status(500).json({ error: 'Server Error: ' + err.message });
  }
};
