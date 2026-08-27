export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const { id, username, first_name, photo_url } = req.body;

        if (!id) {
            return res.status(400).json({ success: false, message: 'Invalid user identification' });
        }

        // Contoh simulasi database lookup/upsert
        // Ganti bagian ini dengan query database (PostgreSQL/MongoDB) Anda.
        const mockUserData = {
            telegram_id: id,
            username: username,
            first_name: first_name,
            photo_url: photo_url,
            coins: 150,       // Saldo koin awal / tersimpan
            atf_balance: 2.5000 // Saldo token ATF awal / tersimpan
        };

        return res.status(200).json({
            success: true,
            message: 'User initialized successfully',
            data: {
                coins: mockUserData.coins,
                atf_balance: mockUserData.atf_balance
            }
        });
    } catch (error) {
        console.error("API Init Error:", error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}
