import { supabase } from '../../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { id, username, first_name, photo_url } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Telegram User ID is required' });
    }

    // Cek apakah user sudah ada
    let { data: user, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (!user) {
      // Jika belum ada, buat user baru beserta data farm default-nya
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([{ id, username, first_name, photo_url, coins: 50.00, atf_balance: 0.0000 }])
        .select()
        .single();

      if (insertError) throw insertError;
      user = newUser;

      // Inisialisasi data farm untuk user baru
      await supabase.from('farms').insert([{ user_id: id, water: 1, fertilizer: 0, seeds: 1, fruits: 0 }]);
    }

    // Ambil juga data farm terkait
    const { data: farm } = await supabase
      .from('farms')
      .select('*')
      .eq('user_id', id)
      .single();

    return res.status(200).json({ success: true, user, farm });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
