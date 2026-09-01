import { supabase } from '../../utils/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  const { id, username, first_name, start_param } = req.body;
  if (!id) return res.status(400).json({ success: false, message: 'Missing user id!' });

  const userIdStr = String(id);
  const now = new Date();

  try {
    let { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userIdStr)
      .maybeSingle();

    if (!user) {
      let referrerId = null;
      if (start_param && start_param.startsWith('ref_')) {
        const potentialReferrer = start_param.replace('ref_', '');
        if (potentialReferrer !== userIdStr) {
          let { data: refUser } = await supabase
            .from('users')
            .select('id')
            .eq('id', potentialReferrer)
            .maybeSingle();
          if (refUser) referrerId = potentialReferrer;
        }
      }

      const initialCoins = 50.00;
      const initialAtf = 0.1000;

      const newUserObj = {
        id: userIdStr,
        username: username || 'Farmer',
        first_name: first_name || 'User',
        coins: initialCoins,
        atf_balance: initialAtf,
        points: 0,
        referred_by: referrerId,
        referral_status: 'PENDING',
        created_at: now,
        updated_at: now
      };

      let { data: insertedUser, error: insertErr } = await supabase
        .from('users')
        .insert([newUserObj])
        .select()
        .single();

      if (insertErr) throw insertErr;
      user = insertedUser;

      await supabase.from('user_farms').insert([{
        user_id: userIdStr,
        seeds: 1,
        water: 3,
        fertilizer: 1,
        fruits: 0,
        updated_at: now
      }]);

      await supabase.from('transactions').insert([{
        user_id: userIdStr,
        type: 'WELCOME_BONUS',
        amount: 50.00,
        currency_type: 'COINS',
        description: 'Welcome bonus: 50 Coins & 0.1 ATF',
        created_at: now
      }]);
    }

    return res.status(200).json({ success: true, user });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Exception: ' + err.message });
  }
}
