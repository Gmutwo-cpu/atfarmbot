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
    const { telegram_id, item_type } = req.body;
    if (!telegram_id || !item_type) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // 1. Define item prices in internal coins
    const prices = {
      'water': 20,       // Harga 1 unit Water = 20 Koin
      'fertilizer': 50   // Harga 1 unit Fertilizer = 50 Koin
    };

    const cost = prices[item_type];
    if (!cost) {
      return res.status(400).json({ error: "Invalid item type" });
    }

    // 2. Get user current data
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegram_id)
      .single();

    if (userErr || !user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.coins < cost) {
      return res.status(400).json({ error: "Not enough coins to buy this item!" });
    }

    // 3. Prepare inventory update based on item type
    let updateData = { coins: user.coins - cost };
    if (item_type === 'water') {
      updateData.water_inventory = (user.water_inventory || 0) + 1;
    } else if (item_type === 'fertilizer') {
      updateData.fertilizer_inventory = (user.fertilizer_inventory || 0) + 1;
    }

    // 4. Update user coins and inventory atomically
    const { error: updateErr } = await supabase
      .from('users')
      .update(updateData)
      .eq('telegram_id', telegram_id);

    if (updateErr) throw updateErr;

    // 5. Record market history
    await supabase
      .from('market_history')
      .insert([{ 
        telegram_id, 
        action_type: 'BUY_ITEM', 
        details: `Bought 1x ${item_type} for ${cost} coins` 
      }]);

    return res.status(200).json({ 
      success: true, 
      message: `Successfully purchased 1x ${item_type}!` 
    });

  } catch (err) {
    return res.status(500).json({ error: "Server Error: " + err.message });
  }
};
