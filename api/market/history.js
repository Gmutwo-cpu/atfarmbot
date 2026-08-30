import { supabase } from '../../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ success: false, message: 'Missing user_id!' });

    const { data: txs, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(10); // Ambil 10 histori terbaru

    if (error) throw error;

    return res.status(200).json({ success: true, history: txs || [] });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
  }
}
