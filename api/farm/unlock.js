import { supabase } from '../../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  try {
    const { user_id, plot_index } = req.body;
    if (!user_id || plot_index === undefined) return res.status(400).json({ success: false, message: 'Missing parameters!' });

    const unlockCosts = { 2: 250, 3: 1000, 4: 5000 };
    const cost = unlockCosts[plot_index];
    if (!cost) return res.status(400).json({ success: false, message: 'Invalid plot index!' });

    let { data: user } = await supabase.from('users').select('*').eq('id', user_id).single();
    if (Number(user.coins) < cost) {
      return res.status(400).json({ success: false, message: `Insufficient Coins! Plot #${plot_index} costs ${cost.toLocaleString()} Coins.` });
    }

    // Kurangi koin & ubah status plot dari LOCKED menjadi EMPTY
    await supabase.from('users').update({ coins: Number(user.coins) - cost }).eq('id', user_id);
    await supabase.from('user_plots').update({ status: 'EMPTY' }).eq('user_id', user_id).eq('plot_index', plot_index);

    return res.status(200).json({ success: true, message: `Plot #${plot_index} unlocked successfully!` });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
}
