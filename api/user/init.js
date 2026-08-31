import { supabase } from '../../utils/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    const { id, username, first_name, photo_url, wallet_address } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, error: 'Missing Telegram user ID!' });
    }

    const userIdStr = String(id);
    const now = new Date();

    // Cek apakah user sudah terdaftar di database
    let { data: user, error: fetchErr } = await supabase
      .from('users')
      .select('*')
      .eq('id', userIdStr)
      .maybeSingle();

    if (fetchErr) {
      throw fetchErr;
    }

    // Jika wallet_address dikirim dari frontend, validasi apakah dompet tersebut sudah dipakai user lain
    let updateFields = { updated_at: now };
    if (wallet_address) {
      const { data: existingWalletUser } = await supabase
        .from('users')
        .select('id')
        .eq('wallet_address', wallet_address)
        .neq('id', userIdStr)
        .maybeSingle();

      if (existingWalletUser) {
        return res.status(400).json({ 
          success: false, 
            error: 'This wallet address is already bound to another account!' 
        });
      }
      updateFields.wallet_address = wallet_address;
    }

    if (!user) {
      // Buat user baru dengan saldo awal 50 Coins dan 0 ATF
      const newUserObj = {
        id: userIdStr,
        username: username || `@user_${userIdStr}`,
        first_name: first_name || 'Farmer',
        photo_url: photo_url || '',
        coins: 50.00,
        atf_balance: 0.0000,
        wallet_address: wallet_address || null,
        created_at: now,
        updated_at: now
      };

      const { data: insertedUser, error: insertErr } = await supabase
        .from('users')
        .insert([newUserObj])
        .select()
        .single();

      if (insertErr) throw insertErr;
      user = insertedUser;

      // Inisialisasi lahan default pertama (Plot #1) untuk user baru
      await supabase.from('farming_plots').insert([{
        user_id: userIdStr,
        plot_index: 1,
        status: 'EMPTY',
        crop_type: null,
        harvest_due_at: null
      }]);
    } else if (wallet_address && user.wallet_address !== wallet_address) {
      // Update wallet_address jika ada perubahan/penautan baru
      await supabase
        .from('users')
        .update({ wallet_address, updated_at: now })
        .eq('id', userIdStr);
      user.wallet_address = wallet_address;
    }

    // Ambil data status pertanian (Water, Fertilizer, Seeds, Fruits)
    let { data: farm, error: farmErr } = await supabase
      .from('user_farms')
      .select('*')
      .eq('user_id', userIdStr)
      .maybeSingle();

    if (farmErr) throw farmErr;

    if (!farm) {
      const defaultFarm = {
        user_id: userIdStr,
        water: 1,
        fertilizer: 0,
        seeds: 1,
        fruits: 0,
        updated_at: now
      };
      const { data: insertedFarm, error: insFarmErr } = await supabase
        .from('user_farms')
        .insert([defaultFarm])
        .select()
        .single();

      if (insFarmErr) throw insFarmErr;
      farm = insertedFarm;
    }

    return res.status(200).json({
      success: true,
      user,
      farm
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: 'Server error: ' + err.message });
  }
}
