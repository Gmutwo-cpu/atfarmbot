import { supabase } from '../../utils/supabase.js';

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
      'watch_ads': 10,
      'story_share': 15,
      'username_badge': 30,
      'bio_link': 50,
      'bind_email': 20
    };

    const rewardCoins = rewards[task_key];
    if (!rewardCoins) {
      return res.status(400).json({ success: false, message: 'Invalid task identifier!' });
    }

    const now = new Date();

    // 1. Validasi Cooldown / Batasan untuk 'claim_bonus' (1 kali sehari / 24 jam)
    if (task_key === 'claim_bonus') {
      const { data: lastClaim } = await supabase
        .from('transactions')
        .select('created_at')
        .eq('user_id', user_id)
        .eq('type', 'CLAIM_BONUS')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (lastClaim) {
        const lastTime = new Date(lastClaim.created_at).getTime();
        const diffHours = (now.getTime() - lastTime) / (1000 * 60 * 60);
        if (diffHours < 24) {
          const remainingHours = Math.ceil(24 - diffHours);
          return res.status(400).json({ 
            success: false, 
            message: `Daily Bonus already claimed! Available again in ~${remainingHours} hours.` 
          });
        }
      }
    }

    // 2. Validasi Batasan untuk 'watch_ads' (Maksimal 3 kali sehari)
    if (task_key === 'watch_ads') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data: adsToday } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user_id)
        .eq('type', 'WATCH_ADS')
        .gte('created_at', todayStart.toISOString());

      if (adsToday && adsToday.length >= 3) {
        return res.status(400).json({ 
          success: false, 
          message: 'Daily limit reached! You can only watch sponsor ads 3 times per day.' 
        });
      }
    }

    // 3. Validasi Misi Sekali Selesai (Social Tasks)
    if (task_key !== 'claim_bonus' && task_key !== 'watch_ads') {
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

    // Ambil data user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user_id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ success: false, message: 'User not found!' });
    }

    const updatedCoins = Number(user.coins) + rewardCoins;

    await supabase
      .from('users')
      .update({ coins: updatedCoins, updated_at: now })
      .eq('id', user_id);

    // Catat transaksi
    let txType = task_key === 'claim_bonus' ? 'CLAIM_BONUS' : (task_key === 'watch_ads' ? 'WATCH_ADS' : 'TASK_REWARD');
    await supabase.from('transactions').insert([{
      user_id,
      type: txType,
      amount: rewardCoins,
      currency_type: 'COINS',
      description: `Completed task: ${task_key} (+${rewardCoins} Coins)`
    }]);

    return res.status(200).json({ 
      success: true, 
      message: `Task completed successfully! Reward: +${rewardCoins} Coins added.` 
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
  }
}
