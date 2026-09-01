import { supabase } from '../utils/supabase.js';

/**
 * =====================================================================
 * ATFARM MARKET & LEADERBOARD ROUTER (SERVERLESS FUNCTION)
 * =====================================================================
 * SEASON REWARD FINANCIAL POLICY (Total Pool: 30 ATF / Season):
 * - Rank 1 : 12 ATF (Min. qualification: 10 Points)
 * - Rank 2 : 8 ATF  (Min. qualification: 7 Points)
 * - Rank 3 : 5 ATF  (Min. qualification: 5 Points)
 * - Rank 4 : 3 ATF  (Min. qualification: 3 Points)
 * - Rank 5 : 2 ATF  (Min. qualification: 2 Points)
 * =====================================================================
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const { action, user_id, item_type, action_type, amount, wallet_address } = req.body;

  if (!user_id && action !== 'leaderboard') {
    return res.status(400).json({ success: false, message: 'Missing user_id!' });
  }

  const userIdStr = user_id ? String(user_id) : null;
  const now = new Date();

  try {
    // 0. ACTION: FETCH LEADERBOARD & USER RANK (FILTERED POINTS > 0)
    if (action === 'leaderboard') {
      let { data: topUsers, error: topErr } = await supabase
        .from('users')
        .select('id, username, first_name, points, atf_balance')
        .gt('points', 0)
        .order('points', { ascending: false })
        .order('updated_at', { ascending: true })
        .limit(50);

      if (topErr) throw topErr;

      let userRankInfo = { rank: 'Unranked', points: 0 };
      
      if (userIdStr) {
        let { data: currentUser } = await supabase
          .from('users')
          .select('points')
          .eq('id', userIdStr)
          .maybeSingle();

        if (currentUser) {
          userRankInfo.points = Number(currentUser.points || 0);

          if (userRankInfo.points > 0) {
            let { count, error: countErr } = await supabase
              .from('users')
              .select('*', { count: 'exact', head: true })
              .gt('points', currentUser.points || 0);

            if (!countErr) {
              userRankInfo.rank = `#${(count || 0) + 1}`;
            }
          } else {
            userRankInfo.rank = 'Unranked';
          }
        }
      }

      return res.status(200).json({
        success: true,
        leaderboard: topUsers || [],
        user_rank: userRankInfo
      });
    }

    // 1. ACTION: BUY SUPPLIES
    if (action === 'buy_item' || action_type === 'BUY_ITEM') {
      const prices = { SEED: 10, WATER: 20, FERTILIZER: 50 };
      const cost = prices[item_type];

      if (!cost) return res.status(400).json({ success: false, message: 'Invalid item type!' });

      let { data: user } = await supabase.from('users').select('*').eq('id', userIdStr).single();
      let { data: farm } = await supabase.from('user_farms').select('*').eq('user_id', userIdStr).single();

      if (!user || !farm) return res.status(404).json({ success: false, message: 'User/Farm not found!' });
      if (Number(user.coins) < cost) return res.status(400).json({ success: false, message: 'Insufficient Coins!' });

      await supabase.from('users').update({ coins: Number(user.coins) - cost, updated_at: now }).eq('id', userIdStr);

      let updateData = { updated_at: now };
      if (item_type === 'SEED') updateData.seeds = (farm.seeds || 0) + 1;
      if (item_type === 'WATER') updateData.water = (farm.water || 0) + 1;
      if (item_type === 'FERTILIZER') updateData.fertilizer = (farm.fertilizer || 0) + 1;

      await supabase.from('user_farms').update(updateData).eq('user_id', userIdStr);
      await supabase.from('transactions').insert([{
        user_id: userIdStr, type: `BUY_${item_type}`, amount: cost, currency_type: 'COINS', description: `Purchased 1x ${item_type}`, created_at: now
      }]);

      return res.status(200).json({ success: true, message: `Successfully purchased 1x ${item_type}!` });
    }

    // 2. ACTION: TRANSACT MARKET (SELL / EXCHANGE)
    if (action === 'transact' || action_type === 'SELL_FRUITS' || action_type === 'EXCHANGE_ATF') {
      let { data: user } = await supabase.from('users').select('*').eq('id', userIdStr).single();
      let { data: farm } = await supabase.from('user_farms').select('*').eq('user_id', userIdStr).single();

      if (!user || !farm) return res.status(404).json({ success: false, message: 'Data not found!' });

      if (action_type === 'SELL_FRUITS') {
        if (farm.fruits < 1) return res.status(400).json({ success: false, message: 'No fruits to sell!' });
        const earnedCoins = farm.fruits * 45;

        await supabase.from('user_farms').update({ fruits: 0, updated_at: now }).eq('id', userIdStr);
        await supabase.from('users').update({ coins: Number(user.coins) + earnedCoins, updated_at: now }).eq('id', userIdStr);
        await supabase.from('transactions').insert([{
          user_id: userIdStr, type: 'SELL_FRUIT', amount: earnedCoins, currency_type: 'COINS', description: `Sold fruits for ${earnedCoins} Coins`, created_at: now
        }]);

        return res.status(200).json({ success: true, message: `Sold fruits for +${earnedCoins} Coins!` });
      } 
      else if (action_type === 'EXCHANGE_ATF') {
        if (Number(user.coins) < 500) return res.status(400).json({ success: false, message: 'Need at least 500 Coins!' });

        const newCoins = Number(user.coins) - 500;
        const newAtf = Number(user.atf_balance || 0) + 1.0000;
        const newPoints = Number(user.points || 0) + 1;

        await supabase.from('users').update({ coins: newCoins, atf_balance: newAtf, points: newPoints, updated_at: now }).eq('id', userIdStr);
        await supabase.from('transactions').insert([{
          user_id: userIdStr, type: 'EXCHANGE_ATF', amount: 1.0000, currency_type: 'ATF', description: 'Exchanged 500 Coins for 1 ATF & +1 Point', created_at: now
        }]);

        return res.status(200).json({ success: true, message: 'Exchanged 500 Coins for 1 ATF & +1 Point!' });
      }
    }

    // 3. ACTION: HISTORY
    if (action === 'history') {
      const { data: txs } = await supabase.from('transactions').select('*').eq('user_id', userIdStr).order('created_at', { ascending: false }).limit(15);
      return res.status(200).json({ success: true, history: txs || [] });
    }

    // 4. ACTION: WITHDRAW
    if (action === 'withdraw') {
      const withdrawAmount = Number(amount);
      if (!withdrawAmount || withdrawAmount <= 0 || withdrawAmount > 500) return res.status(400).json({ success: false, message: 'Invalid amount (Max 500 ATF)!' });

      let { data: user } = await supabase.from('users').select('*').eq('id', userIdStr).single();
      if (Number(user.coins) < 25000) return res.status(400).json({ success: false, message: 'Need at least 25,000 Coins to withdraw!' });
      if (Number(user.atf_balance) < withdrawAmount) return res.status(400).json({ success: false, message: 'Insufficient ATF balance!' });

      const targetWallet = wallet_address || user.wallet_address;
      if (!targetWallet) return res.status(400).json({ success: false, message: 'Wallet not connected!' });

      let newAtfBalance = Number(user.atf_balance) - withdrawAmount;
      await supabase.from('users').update({ atf_balance: newAtfBalance, updated_at: now }).eq('id', userIdStr);
      await supabase.from('transactions').insert([{
        user_id: userIdStr, type: 'WITHDRAW_ATF', amount: withdrawAmount, currency_type: 'ATF', description: `Withdrew ${withdrawAmount} ATF`, created_at: now
      }]);

      return res.status(200).json({ success: true, message: `Successfully withdrew ${withdrawAmount} ATF!`, new_atf: newAtfBalance });
    }

    // 5. ACTION: REFERRAL STATS & LIST
    if (action === 'referral_stats') {
      let { data: invites } = await supabase
        .from('users')
        .select('id, username, first_name, referral_status, created_at')
        .eq('referred_by', userIdStr)
        .order('created_at', { ascending: false });

      const activeCount = invites ? invites.filter(i => i.referral_status === 'ACTIVE').length : 0;
      const pendingCount = invites ? invites.filter(i => i.referral_status === 'PENDING').length : 0;

      return res.status(200).json({
        success: true,
        stats: {
          active: activeCount,
          pending: pendingCount,
          total_atf: activeCount * 1.0000,
          total_points: activeCount * 1,
          total_coins: activeCount * 50.00
        },
        invites: invites || []
      });
    }

    return res.status(400).json({ success: false, message: 'Invalid action.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Exception: ' + err.message });
  }
}
