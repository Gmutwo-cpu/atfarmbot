import { supabase } from '../../utils/supabase.js';

export default async function handler(req, res) {
  // Izinkan metode POST
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { user_id, package_type } = req.body;
    if (!user_id || !package_type) {
      return res.status(400).json({ success: false, message: 'Missing user_id or package_type parameters!' });
    }

    const BOT_TOKEN = process.env.BOT_TOKEN;
    if (!BOT_TOKEN) {
      return res.status(500).json({ success: false, message: 'Server configuration error: BOT_TOKEN is missing!' });
    }

    let title = '';
    let description = '';
    let amountInStars = 0;
    let payloadData = '';

    if (package_type === 'COINS') {
      title = '100x Farm Coins';
      description = 'Instant top-up for 100 in-game Coins to buy seeds and items.';
      amountInStars = 50; // 50 Telegram Stars
      payloadData = `TOPUP_COINS_${user_id}_${Date.now()}`;
    } else if (package_type === 'ATF') {
      title = '1.0000 ATF Milestone';
      description = 'Instant top-up for 1.0000 ATF achievement milestone balance.';
      amountInStars = 150; // 150 Telegram Stars
      payloadData = `TOPUP_ATF_${user_id}_${Date.now()}`;
    } else {
      return res.status(400).json({ success: false, message: 'Invalid package type selected!' });
    }

    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`;
    
    const invoicePayload = {
      title: title,
      description: description,
      payload: payloadData,
      currency: 'XTR', // Kode resmi untuk Telegram Stars
      prices: [
        { label: title, amount: amountInStars }
      ]
    };

    const tgResponse = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invoicePayload)
    });

    const tgResult = await tgResponse.json();

    if (!tgResult.ok) {
      return res.status(400).json({ 
        success: false, 
        message: `Telegram API Error: ${tgResult.description || 'Failed to generate invoice link'}` 
      });
    }

    return res.status(200).json({
      success: true,
      invoice_link: tgResult.result
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server Exception: ' + err.message });
  }
}
