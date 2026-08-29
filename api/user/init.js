import { supabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { id, username, first_name, photo_url } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Telegram User ID is required' });
    }

    // 1. Cek atau buat user baru
    let { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (!user) {
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([{ id, username, first_name, photo_url, coins: 50.00, atf_balance: 0.0000 }])
        .select()
        .single();

      if (insertError) throw insertError;
      user = newUser;

      // Buat data farm default untuk user baru
      await supabase.from('farms').insert([{ user_id: id, water: 1, fertilizer: 0, seeds: 1, fruits: 0 }]);
    } else {
      // Update info profil terbaru jika berubah
      await supabase.from('users').update({ username, first_name, photo_url, updated_at: new Date() }).eq('id', id);
    }

    // 2. Ambil data farm terkait
    let { data: farm } = await supabase
      .from('farms')
      .select('*')
      .eq('user_id', id)
      .single();

    return res.status(200).json({ success: true, user, farm });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
