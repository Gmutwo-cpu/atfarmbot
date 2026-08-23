const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { telegram_id, action_type, item_type } = req.body;
    if (!telegram_id || !action_type) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // Get current user data
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegram_id)
      .single();

    if (userErr || !user) {
      return res.status(404).json({ error: "User not found" });
    }

    let updateData = {};
    let message = "";

    // 1. BUY ITEMS OR SEEDS
    if (action_type === 'BUY') {
      const prices = {
        'water': 20,
        'fertilizer': 50,
        'seed': 10,
        'vip_pass': 1000 // VIP dicapai via koin game (Anti Pay-to-Win)
      };

      const cost = prices[item_type];
      if (!cost) return res.status(400).json({ error: "Invalid item type" });

      if (user.coins < cost) {
        return res.status(400).json({ error: "Not enough coins to buy this item!" });
      }

      updateData.coins = user.coins - cost;

      if (item_type === 'water') {
        updateData.water_inventory = (user.water_inventory || 0) + 1;
      } else if (item_type === 'fertilizer') {
        updateData.fertilizer_inventory = (user.fertilizer_inventory || 0) + 1;
      } else if (item_type === 'seed') {
        updateData.seed_inventory = (user.seed_inventory || 0) + 1;
      } else if (item_type === 'vip_pass') {
        updateData.is_vip = true;
      }

      message = `Successfully purchased 1x ${item_type}!`;
    } 
    // 2. SELL HARVESTED FRUits FOR COINS
    else if (action_type === 'SELL_FRUIT') {
      const fruitCount = user.fruit_inventory || 0;
      if (fruitCount <= 0) {
        return res.status(400).json({ error: "No fruits available to sell!" });
      }

      const coinReward = fruitCount * 45; // 1 Fruit = 45 Coins
      updateData.fruit_inventory = 0;
      updateData.coins = user.coins + coinReward;

      message = `Successfully sold fruits for ${coinReward} coins!`;
    } 
    else {
      return res.status(400).json({ error: "Invalid action type" });
    }

    // Update Database Atomically
    const { error: updateErr } = await supabase
      .from('users')
      .update(updateData)
      .eq('telegram_id', telegram_id);

    if (updateErr) throw updateErr;

    // Record History
    await supabase.from('market_history').insert([{
      telegram_id,
      action_type,
      details: message
    }]);

    return res.status(200).json({ success: true, message });

  } catch (err) {
    return res.status(500).json({ error: "Server Error: " + err.message });
  }
};
