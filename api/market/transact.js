const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { telegram_id, action, amount = 1 } = req.body;
    if (!telegram_id || !action) return res.status(400).json({ error: 'Missing parameters' });

    // Fetch user data
    let { data: user, error: userErr } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegram_id)
      .single();

    if (userErr || !user) return res.status(404).json({ error: 'User not found' });

    let updates = {};
    let logDetail = '';
    let coinCost = 0;
    let coinGain = 0;

    switch (action) {
      case 'buy_seed':
        coinCost = 10 * amount;
        if (user.coins < coinCost) return res.status(400).json({ error: 'Not enough coins!' });
        updates.coins = user.coins - coinCost;
        updates.seed_inventory = (user.seed_inventory || 0) + amount;
        logDetail = `Purchased ${amount}x Seed`;
        break;

      case 'buy_water':
        coinCost = 20 * amount;
        if (user.coins < coinCost) return res.status(400).json({ error: 'Not enough coins!' });
        updates.coins = user.coins - coinCost;
        updates.water_inventory = (user.water_inventory || 0) + amount;
        logDetail = `Purchased ${amount}x Water Supply`;
        break;

      case 'buy_fertilizer':
        coinCost = 50 * amount;
        if (user.coins < coinCost) return res.status(400).json({ error: 'Not enough coins!' });
        updates.coins = user.coins - coinCost;
        updates.fertilizer_inventory = (user.fertilizer_inventory || 0) + amount;
        logDetail = `Purchased ${amount}x Fertilizer`;
        break;

      case 'sell_fruit':
        const fruitCount = user.fruit_inventory || 0;
        if (fruitCount <= 0) return res.status(400).json({ error: 'No harvested fruits to sell!' });
        coinGain = fruitCount * 45; // 45 coins per fruit
        updates.coins = user.coins + coinGain;
        updates.fruit_inventory = 0;
        logDetail = `Sold ${fruitCount}x Fruits for ${coinGain} Coins`;
        break;

      case 'exchange_atf':
        // Rate: 500 Coins = 1.0000 ATF (Sustainable conversion rate)
        coinCost = 500 * amount;
        if (user.coins < coinCost) return res.status(400).json({ error: 'Not enough coins! Need 500 Coins for 1 ATF.' });
        updates.coins = user.coins - coinCost;
        updates.atf_balance = parseFloat((user.atf_balance || 0).toFixed(4)) + (1.0 * amount);
        logDetail = `Exchanged ${coinCost} Coins for ${amount}.0000 ATF`;
        break;

      default:
        return res.status(400).json({ error: 'Invalid market action' });
    }

    // Update user in DB
    const { data: updatedUser, error: updateErr } = await supabase
      .from('users')
      .update(updates)
      .eq('telegram_id', telegram_id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Record to market_history
    await supabase.from('market_history').insert([{
      telegram_id,
      activity_type: action,
      details: logDetail,
      amount_coins: coinCost > 0 ? -coinCost : coinGain
    }]);

    // Fetch recent logs
    const { data: history } = await supabase
      .from('market_history')
      .select('*')
      .eq('telegram_id', telegram_id)
      .order('created_at', { ascending: false })
      .limit(5);

    return res.status(200).json({
      success: true,
      user: updatedUser,
      market_history: history || [],
      message: logDetail
    });

  } catch (err) {
    return res.status(500).json({ error: 'Server Error: ' + err.message });
  }
};
