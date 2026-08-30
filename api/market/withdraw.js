import { supabase } from '../../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { user_id, amount } = req.body;
    const withdrawAmount = Number(amount);

    if (!user_id || !withdrawAmount || withdrawAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid withdrawal parameters!' });
    }

    // Batasan maksimal penarikan 500 ATF per transaksi/hari
    if (withdrawAmount > 500) {
      return res.status(400).json({ success: false, message: 'Max withdrawal limit is 500 ATF per day!' });
    }

    // Ambil data user terkini dari database
    let { data: user, error: userErr } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', user_id)
      .single();

    if (userErr || !user) {
      return res.status(404).json({ success: false, message: 'User not found!' });
    }

    // Validasi syarat: Koin minimal harus 25,000
    const currentCoins = Number(user.coins || 0);
    if (currentCoins < 25000) {
      return res.status(400).json({ 
        success: false, 
        message: `Insufficient Coins! You need at least 25,000 Coins to withdraw ATF (Current: ${currentCoins.toLocaleString()}).` 
      });
    }

    // Validasi saldo ATF user
    const currentAtf = Number(user.atf_balance || 0);
    if (currentAtf < withdrawAmount) {
      return res.status(400).json({ success: false, message: 'Insufficient ATF balance for withdrawal!' });
    }

    // Kurangi saldo ATF user
    let newAtfBalance = currentAtf - withdrawAmount;
    let { error: updateErr } = await supabase
      .from('users')
      .update({ atf_balance: newAtfBalance })
      .eq('telegram_id', user_id);

    if (updateErr) {
      throw new Error('Failed to process withdrawal balance update.');
    }

    // Catat histori transaksi penarikan
    await supabase.from('transactions').insert([
      {
        telegram_id: user_id,
        type: 'WITHDRAW_ATF',
        description: `Successfully withdrew ${withdrawAmount.toFixed(4)} ATF tokens.`
      }
    ]);

    return res.status(200).json({
      success: true,
      message: `Withdrawal successful! ${withdrawAmount.toFixed(4)} ATF sent to your external wallet.`,
      new_atf: newAtfBalance
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Exception: ' + err.message });
  }
}
