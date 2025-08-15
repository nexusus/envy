const { Redis } = require('ioredis');
const ip = require('ip');
const crypto = require('crypto');
const {
    FALLBACK_ROBLOX_IP_RANGES,
    AUTH_CACHE_EXPIRATION_SECONDS,
    MODERATION_THRESHOLD,
    USER_AGENT_ROBLOX_LINUX,
    USER_AGENT_AGENT_E,
    REDIS_KEYS,
    FORUM_WEBHOOK_URL,
    SECRET_HEADER_KEY
} = require('./lib/config');

// --- Initialization ---
const redis = new Redis(process.env.AIVEN_VALKEY_URL);
redis.on('error', (err) => console.error('[ioredis] client error:', err));
const { createDiscordEmbed } = require('./lib/discord-helpers');
const { fetchGameInfo, isJobIdAuthentic } = require('./lib/roblox-service');
const { getThreadId, isIpInRanges } = require('./lib/utils');


module.exports = async (request, response) => {
    // Vercel: Check method
    if (request.method !== 'POST') {
        return response.status(405).send('Method Not Allowed.');
    }

    // Vercel: Get IP from 'x-vercel-forwarded-for' header
    const clientIp = request.headers['x-vercel-forwarded-for'];
    if (!clientIp) {
        return response.status(403).send('Forbidden: Could not determine client IP address.');
    }

    // --- Request Validation ---
    const userSecret = request.headers['x-secret-header'];
    const secret = SECRET_HEADER_KEY || '';
    if (!userSecret || !crypto.timingSafeEqual(Buffer.from(userSecret), Buffer.from(secret))) {
        return response.status(401).send('Unauthorized');
    }
    if (request.headers['user-agent'] !== USER_AGENT_ROBLOX_LINUX) {
        return response.status(400).send('Access Denied.');
    }

    // --- IP Validation ---
    let activeIpRanges = FALLBACK_ROBLOX_IP_RANGES;
    try {
        const dynamicRangesJson = await redis.get(REDIS_KEYS.ROBLOX_IP_RANGES);
        if (dynamicRangesJson) activeIpRanges = JSON.parse(dynamicRangesJson);
    } catch (e) {
        console.error("Could not get IP list from Redis.", e);
    }
    const isIpFromRoblox = isIpInRanges(clientIp, activeIpRanges);
    if (!isIpFromRoblox) {
        console.warn(`Rejected request from non-Roblox IP: ${clientIp}`);
        const rejectedIpsCount = await redis.zcard(REDIS_KEYS.REJECTED_IPS);
        if (rejectedIpsCount < 10000) {
            await redis.zincrby(REDIS_KEYS.REJECTED_IPS, 1, clientIp);
        }
        return response.status(200).json({ success: true, message: 'Success' });
    }

    // --- Data Extraction and Validation ---
    const body = request.body;
    const robloxIdHeader = request.headers['roblox-id'];
    let placeId;

    if (!robloxIdHeader || robloxIdHeader === "0") {
        return response.status(200).send('Success!');
    }
    const placeIdMatch = robloxIdHeader.match(/placeId=(\d+)/);
    if (placeIdMatch) {
        placeId = placeIdMatch[1];
    } else if (/^\d+$/.test(robloxIdHeader)) {
        placeId = robloxIdHeader;
    } else {
        return response.status(400).send('Bad Request: 1337');
    }
    const jobId = body.jobId;
    if (!jobId) {
        return response.status(400).send('Bad Request: 1336');
    }

    let lockKey;
    try {
        // --- Core Logic (JobId Auth, Rate Limiting, Discord Message Handling) ---
        const authAttemptKey = `${REDIS_KEYS.AUTH_ATTEMPT_PREFIX}${clientIp}`;
        const attempts = await redis.incr(authAttemptKey);
        if (attempts === 1) {
            await redis.expire(authAttemptKey, 60 * 5); // 5 minutes expiry
        }
        if (attempts > 30) { // Max 30 attempts in 5 minutes
            return response.status(429).send('Too many authentication requests.');
        }

        const authCacheKey = `${REDIS_KEYS.AUTH_PREFIX}${jobId}`;
        const isAlreadyAuthenticated = await redis.get(authCacheKey);
        if (!isAlreadyAuthenticated) {
            const isAuthentic = await isJobIdAuthentic(placeId, jobId);
            if (!isAuthentic) {
                console.warn(`Rejected unauthenticated JobId: ${jobId}`);
                return response.status(403).send('Forbidden: JobId authentication failed.');
            }
            await redis.set(authCacheKey, 'true', 'EX', AUTH_CACHE_EXPIRATION_SECONDS);
        }
        const rateLimitKey = `${REDIS_KEYS.RATE_PREFIX}${jobId}`;
        const currentRequests = await redis.incr(rateLimitKey);
        if (currentRequests === 1) await redis.expire(rateLimitKey, 60);
        if (currentRequests > 20) return response.status(429).send('Too Many Requests');
        
        const { gameInfo, universeId, thumbnail } = await fetchGameInfo(placeId, redis);
        lockKey = `${REDIS_KEYS.LOCK_GAME_PREFIX}${universeId}`;
        const lockAcquired = await redis.set(lockKey, 'locked', 'EX', 10, 'NX');

        if (!lockAcquired) {
            lockKey = null; // Don't release the lock we don't own.
            return response.status(429).send('This game is currently being processed.');
        }

        const gameKey = `${REDIS_KEYS.GAME_PREFIX}${universeId}`;
        const rawGameData = await redis.get(gameKey);
        let gameData = null;
        if (rawGameData) {
            try {
                gameData = JSON.parse(rawGameData);
            } catch (e) {
                console.error("Failed to parse game data:", e);
                // Treat as if no game data was found by leaving gameData as null
            }
        }
        let messageId = gameData ? gameData.messageId : null;
        let threadId = gameData ? gameData.threadId : null;
        const currentTime = Math.floor(Date.now() / 1000);
        const newThreadId = getThreadId(gameInfo.playing);

        if (gameInfo.playing === 0 || gameInfo.description?.includes("envy") || gameInfo.description?.includes("require") || gameInfo.description?.includes("serverside") || !newThreadId) {
            if (messageId) {
                const deleteUrl = `${FORUM_WEBHOOK_URL}/messages/${messageId}?thread_id=${threadId}`;
                const deleteResponse = await fetch(deleteUrl, { method: 'DELETE' });
                if (deleteResponse.ok || deleteResponse.status === 404) {
                    await redis.del(gameKey); // Only delete from Redis if Discord deletion is confirmed
                } else {
                    console.error(`Error deleting Discord message ${messageId} during game update check. Status: ${deleteResponse.status}.`);
                }
            }
            return response.status(200).json({ success: true, action: 'skipped_or_deleted' });
        }

        const payload = createDiscordEmbed(gameInfo, placeId, thumbnail, jobId, false);
        const headers = { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT_AGENT_E };

        if (messageId && threadId === newThreadId) {
            const editUrl = `${FORUM_WEBHOOK_URL}/messages/${messageId}?thread_id=${threadId}`;
            const editResponse = await fetch(editUrl, { method: 'PATCH', headers, body: JSON.stringify(payload) });
            if (!editResponse.ok && editResponse.status === 404) {
                messageId = null;
            }
        } else {
            if (messageId) {
                const deleteUrl = `${FORUM_WEBHOOK_URL}/messages/${messageId}?thread_id=${threadId}`;
                // We don't need to await this one fully because if it fails, the logic below will create a new message anyway.
                // The primary goal here is to remove the old message when the thread changes. The cleanup job will catch any orphans.
                fetch(deleteUrl, { method: 'DELETE' }).catch(err => console.error(`Error deleting Discord message ${messageId} during thread change:`, err));
            }
            messageId = null;
        }
        
        if (!messageId) {
            const createUrl = `${FORUM_WEBHOOK_URL}?wait=true&thread_id=${newThreadId}`;
            const createResponse = await fetch(createUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
            if (!createResponse.ok) throw new Error(`Discord API Error on POST: ${createResponse.status}`);
            const responseData = await createResponse.json();
            messageId = responseData.id;
            threadId = newThreadId;
        }

        // --- MODERATION & PUBLIC LOGIC ---
        const isPublic = await redis.sismember(REDIS_KEYS.PUBLIC_GAMES_SET, universeId);

        // 1. Handle games destined for the moderation channel
        if (gameInfo.playing > MODERATION_THRESHOLD) {
            const isAlreadyModerated = await redis.sismember(REDIS_KEYS.MODERATED_GAMES_SET, universeId);
            const moderationWebhookUrl = process.env.MODERATION_WEBHOOK_URL;
            if (!moderationWebhookUrl) {
                console.error("MODERATION_WEBHOOK_URL is not set. Cannot post to moderation channel.");
            } else {
                const components = [{
                    type: 1, // Action Row
                    components: [
                        isPublic ? {
                            type: 2, // Button
                            style: 4, // Red (Danger)
                            label: 'Privatize',
                            custom_id: `privatize_game_${universeId}`
                        } : {
                            type: 2, // Button
                            style: 3, // Green (Success)
                            label: 'Approve',
                            custom_id: `approve_game_${universeId}`
                        }
                    ]
                }];
                const moderationPayload = createDiscordEmbed(gameInfo, placeId, thumbnail, jobId, false, components);
                
                if (isAlreadyModerated && messageId) {
                    // Edit existing message in moderation channel
                    const editUrl = `${moderationWebhookUrl}/messages/${messageId}`;
                    await fetch(editUrl, { method: 'PATCH', headers, body: JSON.stringify(moderationPayload) });
                } else {
                    // Post new message to moderation channel
                    const createUrl = `${moderationWebhookUrl}?wait=true`;
                    const createResponse = await fetch(createUrl, { method: 'POST', headers, body: JSON.stringify(moderationPayload) });
                    if (createResponse.ok) {
                        const responseData = await createResponse.json();
                        messageId = responseData.id;
                        await redis.sadd(REDIS_KEYS.MODERATED_GAMES_SET, universeId);
                    }
                }
            }
        }

        // 2. Handle games for the public channels
        if (isPublic || gameInfo.playing <= MODERATION_THRESHOLD) {
            const publicPayload = createDiscordEmbed(gameInfo, placeId, thumbnail, jobId, false);
            if (messageId && threadId === newThreadId) {
                const editUrl = `${FORUM_WEBHOOK_URL}/messages/${messageId}?thread_id=${threadId}`;
                const editResponse = await fetch(editUrl, { method: 'PATCH', headers, body: JSON.stringify(publicPayload) });
                if (!editResponse.ok && editResponse.status === 404) {
                    messageId = null;
                }
            } else {
                if (messageId) {
                    const deleteUrl = `${FORUM_WEBHOOK_URL}/messages/${messageId}?thread_id=${threadId}`;
                    fetch(deleteUrl, { method: 'DELETE' }).catch(err => console.error(`Error deleting Discord message ${messageId} during thread change:`, err));
                }
                messageId = null;
            }
            
            if (!messageId) {
                const createUrl = `${FORUM_WEBHOOK_URL}?wait=true&thread_id=${newThreadId}`;
                const createResponse = await fetch(createUrl, { method: 'POST', headers, body: JSON.stringify(publicPayload) });
                if (!createResponse.ok) throw new Error(`Discord API Error on POST: ${createResponse.status}`);
                const responseData = await createResponse.json();
                messageId = responseData.id;
                threadId = newThreadId;
            }
        }

        // 3. Always update the central game data record
        const newGameData = {
            messageId: messageId,
            threadId: threadId,
            timestamp: currentTime,
            placeId: placeId,
            playerCount: gameInfo.playing,
            gameName: gameInfo.name
        };
        const pipeline = redis.pipeline();
        pipeline.set(gameKey, JSON.stringify(newGameData));
        pipeline.zadd('games_by_timestamp', currentTime, gameKey);
        await pipeline.exec();

        return response.status(200).json({ success: true, messageId: messageId });

    } catch (error) {
        console.error("Main Handler Error:", error);
        return response.status(500).send(`Internal Server Error: ${error.message}`);
    } finally {
        if (lockKey) await redis.del(lockKey);
    }
}
