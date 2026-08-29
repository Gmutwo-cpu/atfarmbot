import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { user_id, item_type } = req.body; // item_type: 'SEED', 'WATER', 'FERTILIZER'

    if (!user_id || !item_type) {
      return res.status(400).json({ success: false, message: 'Missing user_id or item_type!' });
    }

    const prices = { SEED: 10, WATER: 20, FERTILIZER: 50 };
    const cost = prices[item_type];

    if (!cost) {
      return res.status(400).json({ success: false, message: 'Invalid item type selected!' });
    }

    // Ambil data user untuk cek saldo koin
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user_id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ success: false, message: 'User not found!' });
    }

    if (Number(user.coins) < cost) {
      return res.status(400).json({ success: false, message: 'Insufficient Coins! Complete tasks or sell fruits.' });
    }

    // Ambil data farm user
    const { data: farm, error: farmError } = await supabase
      .from('farms')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (farmError || !farm) {
      return res.status(404).json({ success: false, message: 'Farm data not found!' });
    }

    // Kurangi koin pengguna
    const { error: updateCoinError } = await supabase
      .from('users')
      .update({ coins: Number(user.coins) - cost, updated_at: new Date() })
      .eq('id', user_id);

    if (updateCoinError) throw updateCoinError;

    // Tambah inventaris item terkait di tabel farms
    let updateData = {};
    if (item_type === 'SEED') updateData.seeds = farm.seeds + 1;
    if (item_type === 'WATER') updateData.water = farm.water + 1;
    if (item_type === 'FERTILIZER') updateData.fertilizer = farm.fertilizer + 1;
    updateData.updated_at = new Date();

    const { error: updateFarmError } = await supabase
      .from('farms')
      .update(updateData)
      .eq('user_id', user_id);

    if (updateFarmError) throw updateFarmError;

    // Catat transaksi ke tabel transactions
    await supabase.from('transactions').insert([{
      user_id,
      type: `BUY_${item_type}`,
      amount: cost,
      currency_type: 'COINS',
      description: `Purchased 1x ${item_type} for ${cost} coins`
    }]);

    return res.status(200).json({ 
      success: true, 
      message: `Successfully purchased 1x ${item_type}!` 
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
  }
}
