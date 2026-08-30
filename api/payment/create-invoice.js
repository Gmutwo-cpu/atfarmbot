import { supabase } from '../../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { user_id, package_type, tier_id } = req.body;
    if (!user_id || !package_type || !tier_id) {
      return res.status(400).json({ success: false, message: 'Missing required parameters (user_id, package_type, tier_id)!' });
    }

    const BOT_TOKEN = process.env.BOT_TOKEN;
    if (!BOT_TOKEN) {
      return res.status(500).json({ success: false, message: 'Server configuration error: BOT_TOKEN is missing!' });
    }

    let title = '';
    let description = '';
    let amountInStars = 0;
    let payloadData = '';

    // LOGIKA 1: FIXED TIER UNTUK COINS
    if (package_type === 'COINS') {
      if (tier_id === 'starter') {
        title = 'Starter Coins Pack (100 Coins)';
        description = 'Basic package for casual farming supplies.';
        amountInStars = 30; // 30 Telegram Stars
      } else if (tier_id === 'popular') {
        title = 'Farmer Pro Pack (500 Coins + Bonus)';
        description = 'Most popular choice for active farmers.';
        amountInStars = 120; // 120 Telegram Stars
      } else if (tier_id === 'whale') {
        title = 'Agro Empire Pack (2,500 Coins)';
        description = 'Maximum value package for serious tycoons.';
        amountInStars = 500; // 500 Telegram Stars
      } else {
        return res.status(400).json({ success: false, message: 'Invalid Coins tier selected!' });
      }
      payloadData = `TOPUP_COINS_${tier_id}_${user_id}_${Date.now()}`;
    } 
    // LOGIKA 2: DYNAMIC MARKET RATE UNTUK ATF MILESTONE
    else if (package_type === 'ATF') {
      // Simulasi Dynamic Price Oracle (bisa diganti fetch API harga real-time eksternal, misal CoinGecko/DEX)
      // Asumsi kurs pasar dinamis saat ini: 1 ATF setara dengan ~150 Telegram Stars (contoh basis pasar)
      const baseMarketRateStarsPerAtf = 150; 

      let atfAmount = 0;
      if (tier_id === 'tier_1') {
        atfAmount = 1.0; // 1 ATF
      } else if (tier_id === 'tier_5') {
        atfAmount = 5.0; // 5 ATF (dengan diskon volume pasar dinamis)
      } else if (tier_id === 'tier_20') {
        atfAmount = 20.0; // 20 ATF (Whale Market Tier)
      } else {
        return res.status(400).json({ success: false, message: 'Invalid ATF tier selected!' });
      }

      // Kalkulasi dinamis harga stars berdasarkan market rate
      amountInStars = Math.round(atfAmount * baseMarketRateStarsPerAtf);
      title = `${atfAmount.toFixed(4)} ATF Milestone`;
      description = `Dynamic market-rate asset milestone (${baseMarketRateStarsPerAtf} Stars/ATF).`;
      payloadData = `TOPUP_ATF_${atfAmount}_${user_id}_${Date.now()}`;
    } else {
      return res.status(400).json({ success: false, message: 'Invalid package type!' });
    }

    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`;
    
    const invoicePayload = {
      title: title,
      description: description,
      payload: payloadData,
      currency: 'XTR', // Telegram Stars currency
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
