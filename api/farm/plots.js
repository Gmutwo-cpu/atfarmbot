import { supabase } from '../../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { user_id } = req.body;
    if (!user_id) {
      return res.status(400).json({ success: false, message: 'Missing user_id!' });
    }

    let { data: plots, error } = await supabase
      .from('user_plots')
      .select('*')
      .eq('user_id', user_id)
      .order('plot_index', { ascending: true });

    if (error) throw error;

    if (!plots || plots.length === 0) {
      const defaultPlots = [
        { user_id, plot_index: 1, status: 'EMPTY', crop_type: 'APPLE' },
        { user_id, plot_index: 2, status: 'LOCKED', crop_type: 'APPLE' },
        { user_id, plot_index: 3, status: 'LOCKED', crop_type: 'APPLE' },
        { user_id, plot_index: 4, status: 'LOCKED', crop_type: 'APPLE' }
      ];
      
      await supabase.from('user_plots').insert(defaultPlots);
      plots = defaultPlots;
    }

    return res.status(200).json({ success: true, plots });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Error: ' + err.message });
  }
}
