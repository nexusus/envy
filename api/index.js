import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
    const redis = new Redis({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
    });

    const REAL_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
    const SECRET_HEADER = process.env.SECRET_HEADER_KEY;
    const AUTH_CACHE_EXPIRATION_SECONDS = 300; // 5 minutes
    
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed.');
    if (req.headers['x-secret-header'] !== SECRET_HEADER) return res.status(401).send('Unauthorized');

    async function isJobIdAuthentic(placeId, targetJobId) {
        const apiUrl = 'https://gamejoin.roblox.com/v1/join-game-instance';
        try {
            
            const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Roblox/WinInet' // Use a standard Roblox user agent
            },
            body: JSON.stringify({
                placeId: placeId,
                gameId: targetJobId
            })
        });
        // A successful lookup, even if it returns an error meant for a client (like "Join_Error"),
        // usually means the server exists. A hard 400 or 500 often means it doesn't.
        // We'll consider any non-500/404 response as potentially valid for this check.
        return apiResponse.status < 500;
    
        } catch (error) {
            console.error("Error during JobId authentication:", error);
            return false; // Fail safely on any exception
        }
    }

    const { gameId, placeId, jobId, payload } = req.body;
    if (!gameId || !placeId || !jobId) {
        return res.status(400).send('Bad Request: Missing required IDs.');
    }

    const authCacheKey = `auth:${jobId}`;
    const isAlreadyAuthenticated = await redis.get(authCacheKey);

    if (!isAlreadyAuthenticated) {
        // If not in cache, perform the expensive check
        console.log(`JobId ${jobId} not in cache. Performing live authentication...`);
        const isAuthentic = await isJobIdAuthentic(placeId, jobId);

        if (!isAuthentic) {
            console.warn(`Rejected unauthenticated JobId: ${jobId}`);
            return res.status(403).send('Forbidden: JobId authentication failed.');
        }
        // If authentic, save to cache with a 5-minute expiration
        await redis.set(authCacheKey, 'true', { ex: AUTH_CACHE_EXPIRATION_SECONDS });
    }

    // Rate limit every request, even cached ones
    const rateLimitKey = `rate:${jobId}`;
    const currentRequests = await redis.incr(rateLimitKey);
    if (currentRequests === 1) await redis.expire(rateLimitKey, 60);
    if (currentRequests > 20) return res.status(429).send('Too Many Requests');
    
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
