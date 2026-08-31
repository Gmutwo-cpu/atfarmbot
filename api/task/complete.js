import { supabase } from '../../utils/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
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
      'bio_link': 50
    };

    const rewardCoins = rewards[task_key];
    if (!rewardCoins) {
      return res.status(400).json({ success: false, message: 'Invalid task identifier!' });
    }

    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // 1. Validasi Cooldown 24 Jam khusus untuk 'claim_bonus'
    if (task_key === 'claim_bonus') {
      const { data: lastClaim } = await supabase
        .from('transactions')
        .select('created_at')
        .eq('user_id', user_id)
        .eq('type', 'CLAIM_BONUS')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastClaim) {
        let nextAvailable = new Date(lastClaim.created_at).getTime() + (24 * 60 * 60 * 1000);
        if (now.getTime() < nextAvailable) {
          return res.status(400).json({ success: false, cooldown_until: nextAvailable, message: 'Daily Bonus already claimed! Please wait.' });
        }
      }
    }

    // 2. Validasi Batasan 'watch_ads' (Maksimal 3 kali sehari)
    if (task_key === 'watch_ads') {
      const { data: adsToday } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user_id)
        .eq('type', 'WATCH_ADS')
        .gte('created_at', todayStart.toISOString());

      if (adsToday && adsToday.length >= 3) {
        return res.status(400).json({ success: false, message: 'Daily limit reached! Max 3 times per day.' });
      }
    }

    // 3. Validasi Harian untuk Special Missions (Sekali sehari: story_share, username_badge, bio_link)
    if (['story_share', 'username_badge', 'bio_link'].includes(task_key)) {
      const txType = `SPECIAL_TASK_${task_key.toUpperCase()}`;
      const { data: completedToday } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user_id)
        .eq('type', txType)
        .gte('created_at', todayStart.toISOString())
        .maybeSingle();

      if (completedToday) {
        return res.status(400).json({ success: false, message: 'You have already completed this special mission today!' });
      }
    }

    // Ambil data user
    let { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user_id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ success: false, message: 'User not found!' });
    }

    const updatedCoins = Number(user.coins) + rewardCoins;
    await supabase.from('users').update({ coins: updatedCoins, updated_at: now }).eq('id', user_id);

    // Tentukan tipe transaksi
    let recordedType = task_key === 'claim_bonus' ? 'CLAIM_BONUS' : (task_key === 'watch_ads' ? 'WATCH_ADS' : `SPECIAL_TASK_${task_key.toUpperCase()}`);
    
    await supabase.from('transactions').insert([{
      user_id,
      type: recordedType,
      amount: rewardCoins,
      currency_type: 'COINS',
      description: `Completed task: ${task_key} (+${rewardCoins} Coins)`,
      created_at: now
    }]);

    let responsePayload = {
      success: true,
      message: `Task completed successfully! Reward: +${rewardCoins} Coins added.`
    };

    if (task_key === 'claim_bonus') {
      responsePayload.cooldown_until = now.getTime() + (24 * 60 * 60 * 1000);
    }

    return res.status(200).json(responsePayload);

  } catatch (err) {
    return res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
  }
}
