import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
    const redis = new Redis({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
    });

    const REAL_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
    const SECRET_HEADER = process.env.SECRET_HEADER_KEY;

    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed.');
    if (req.headers['x-secret-header'] !== SECRET_HEADER) return res.status(401).send('Unauthorized');

    const { gameId, payload } = req.body;
    if (!gameId) return res.status(400).send('Bad Request: Missing GameId.');

    try {
        let messageId = await redis.get(`game:${gameId}`);
        const headers = { 'Content-Type': 'application/json', 'User-Agent': 'Agent-E' };

        if (!messageId) {
            const createUrl = `${REAL_WEBHOOK_URL}?wait=true`;
            const createResponse = await fetch(createUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
            if (!createResponse.ok) throw new Error(`Discord API Error on POST: ${createResponse.status}`);
            const responseData = await createResponse.json();
            messageId = responseData.id;
            await redis.set(`game:${gameId}`, messageId);
        } else {
            const editUrl = `${REAL_WEBHOOK_URL}/messages/${messageId}`;
            await fetch(editUrl, { method: 'PATCH', headers, body: JSON.stringify(payload) });
        }
        return res.status(200).json({ messageId: messageId });
    } catch (error) {
        console.error("Serverless Function Error:", error);
        return res.status(500).send(`Internal Server Error: ${error.message}`);
    }
}
