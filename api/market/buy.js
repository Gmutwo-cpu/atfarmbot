import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { user_id, item_type } = req.body; // 'SEED', 'WATER', 'FERTILIZER'
    
    const prices = { SEED: 10, WATER: 20, FERTILIZER: 50 };
    const cost = prices[item_type];
    if (!cost) return res.status(400).json({ success: false, message: 'Invalid item type!' });

    const { data: user } = await supabase.from('users').select('*').eq('id', user_id).single();
    if (!user || user.coins < cost) {
      return res.status(400).json({ success: false, message: 'Insufficient Coins!' });
    }

    const { data: farm } = await supabase.from('farms').select('*').eq('user_id', user_id).single();

    // Kurangi koin user
    await supabase.from('users').update({ coins: user.coins - cost }).eq('id', user_id);

    // Tambah item inventaris farm
    let updateData = {};
    if (item_type === 'SEED') updateData.seeds = farm.seeds + 1;
    if (item_type === 'WATER') updateData.water = farm.water + 1;
    if (item_type === 'FERTILIZER') updateData.fertilizer = farm.fertilizer + 1;

    await supabase.from('farms').update(updateData).eq('user_id', user_id);

    // Catat transaksi
    await supabase.from('transactions').insert([{
      user_id, type: `BUY_${item_type}`, amount: cost, currency_type: 'COINS', description: `Purchased 1x ${item_type}`
    }]);

    return res.status(200).json({ success: true, message: `Successfully purchased ${item_type}!` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
