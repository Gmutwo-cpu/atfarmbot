import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { user_id, task_key } = req.body;

    if (!user_id || !task_key) {
      return res.status(400).json({ success: false, message: 'Missing user_id or task_key!' });
    }

    const rewards = {
      'claim_bonus': 15,
      'watch_ads': 10,        // Reward nonton iklan penopang server
      'story_share': 15,
      'username_badge': 30,
      'bio_link': 50,
      'bind_email': 20
    };

    const rewardCoins = rewards[task_key];
    if (!rewardCoins) {
      return res.status(400).json({ success: false, message: 'Invalid task identifier!' });
    }

    // Misi harian seperti watch_ads dan claim_bonus boleh diulang, misi sosial sekali saja
    if (task_key !== 'claim_bonus' && task_key !== 'watch_ads' && task_key !== 'story_share') {
      const { data: existingTask } = await supabase
        .from('tasks_completed')
        .select('*')
        .eq('user_id', user_id)
        .eq('task_key', task_key)
        .single();

      if (existingTask) {
        return res.status(400).json({ success: false, message: 'This task has already been completed!' });
      }

      await supabase.from('tasks_completed').insert([{ user_id, task_key }]);
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user_id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ success: false, message: 'User not found!' });
    }

    const updatedCoins = Number(user.coins) + rewardCoins;

    const { error: updateError } = await supabase
      .from('users')
      .update({ coins: updatedCoins, updated_at: new Date() })
      .eq('id', user_id);

    if (updateError) throw updateError;

    return res.status(200).json({ 
      success: true, 
      message: `Task completed successfully! Reward: +${rewardCoins} Coins added.` 
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
  }
}
