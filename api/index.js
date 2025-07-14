// This function will handle ALL requests (POST, PATCH, GET, etc.)
export default async function handler(req, res) {
    // --- SECURITY & CONFIG ---
    const REAL_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
    const SECRET_HEADER = process.env.SECRET_HEADER_KEY;

    // Immediately reject anything that isn't a POST or PATCH
    if (req.method !== 'POST' && req.method !== 'PATCH') {
        return res.status(405).send('Method Not Allowed');
    }

    // --- Security Checks ---
    if (req.headers['x-secret-header'] !== SECRET_HEADER) {
        return res.status(401).send('Unauthorized');
    }
    if (!req.body.jobId) {
        return res.status(400).send('Bad Request: Missing JobId.');
    }

    // --- Logic ---
    try {
        if (req.method === 'POST') {
            const { payload } = req.body;
            const response = await fetch(REAL_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'User-Agent': 'Agent-E' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error(`Discord API Error: ${response.status}`);
            const responseData = await response.json();
            return res.status(200).json({ messageId: responseData.id });

        } else if (req.method === 'PATCH') {
            // LOGIC TO EDIT AN EXISTING MESSAGE
            const { messageId, payload } = req.body;
            if (!messageId) return res.status(400).send('Bad Request: Missing messageId.');
            
            const editUrl = `${REAL_WEBHOOK_URL}/messages/${messageId}`;
            const response = await fetch(editUrl, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'User-Agent': 'Agent-E' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error(`Discord API Error: ${response.status}`);
            return res.status(200).send('OK');
        }
    } catch (error) {
        console.error("Serverless Function Error:", error);
        return res.status(500).send('Internal Server Error');
    }
}
