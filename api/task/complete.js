import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { user_id, task_key } = req.body; // e.g., 'story_share', 'username_badge', etc.
    const rewards = {
      'story_share': 15,
      'username_badge': 30,
      'bio_link': 50,
      'bind_email': 20,
      'claim_bonus': 15
    };

    const rewardCoins = rewards[task_key];
    if (!rewardCoins) return res.status(400).json({ success: false, message: 'Invalid task identifier!' });

    // Cek apakah misi sudah pernah diselesaikan (khusus untuk task non-harian)
    if (task_key !== 'claim_bonus' && task_key !== 'story_share') {
      const { data: existing } = await supabase
        .from('tasks_completed')
        .select('*')
        .eq('user_id', user_id)
        .eq('task_key', task_key)
        .single();

      if (existing) {
        return res.status(400).json({ success: false, message: 'Task already completed!' });
      }
      await supabase.from('tasks_completed').insert([{ user_id, task_key }]);
    }

    // Tambahkan koin ke user
    const { data: user } = await supabase.from('users').select('*').eq('id', user_id).single();
    await supabase.from('users').update({ coins: Number(user.coins) + rewardCoins }).eq('id', user_id);

    return res.status(200).json({ success: true, message: `Task completed! Reward: +${rewardCoins} Coins added.` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
