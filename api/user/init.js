import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  // Atur header CORS agar aman diakses oleh frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    const { id, username, first_name, photo_url } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, error: 'Telegram User ID is required' });
    }

    // 1. Cek atau buat user baru di tabel users
    let { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      // PGRST116 adalah kode error standar Supabase jika data single() tidak ditemukan
      throw new Error('Database User Error: ' + userError.message);
    }

    if (!user) {
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([{ id, username, first_name, photo_url, coins: 50.00, atf_balance: 0.0000 }])
        .select()
        .single();

      if (insertError) throw new Error('Insert User Error: ' + insertError.message);
      user = newUser;

      // Buat data farm default untuk user baru
      const { error: farmInsertError } = await supabase
        .from('farms')
        .insert([{ user_id: id, water: 1, fertilizer: 0, seeds: 1, fruits: 0 }]);

      if (farmInsertError) throw new Error('Insert Farm Error: ' + farmInsertError.message);
    } else {
      // Perbarui profil jika ada perubahan
      await supabase.from('users').update({ username, first_name, photo_url, updated_at: new Date() }).eq('id', id);
    }

    // 2. Ambil data farm terkait
    let { data: farm, error: farmFetchError } = await supabase
      .from('farms')
      .select('*')
      .eq('user_id', id)
      .single();

    if (farmFetchError) {
      // Jika karena suatu hal data farm belum ada, buatkan secara otomatis
      await supabase.from('farms').insert([{ user_id: id, water: 1, fertilizer: 0, seeds: 1, fruits: 0 }]);
      let { data: newFarm } = await supabase.from('farms').select('*').eq('user_id', id).single();
      farm = newFarm;
    }

    return res.status(200).json({ success: true, user, farm });
  } catch (err) {
    console.error("API Init Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
