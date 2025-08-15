const crypto = require('crypto');
const { redis } = require('./lib/redis');
const {
    FALLBACK_ROBLOX_IP_RANGES,
    AUTH_CACHE_EXPIRATION_SECONDS,
    MODERATION_THRESHOLD,
    USER_AGENT_ROBLOX_LINUX,
    USER_AGENT_AGENT_E,
    REDIS_KEYS,
    FORUM_WEBHOOK_URL,
    MODERATION_WEBHOOK_URL,
    MODERATION_CHANNEL_ID,
    SECRET_HEADER_KEY,
    DISCORD_CONSTANTS
} = require('./lib/config');
const { createDiscordEmbed, sendDiscordMessage, editDiscordMessage, deleteDiscordMessage } = require('./lib/discord-helpers');
const { fetchGameInfo, isJobIdAuthentic } = require('./lib/roblox-service');
const { getThreadId, isIpInRanges } = require('./lib/utils');

// --- Initialization ---

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
            }
        }
        let moderationMessageId = gameData ? gameData.moderationMessageId : null;
        let publicMessageId = gameData ? gameData.publicMessageId : null;
        let publicThreadId = gameData ? gameData.publicThreadId : null;
        const currentTime = Math.floor(Date.now() / 1000);

        // --- Game Filtering ---
        // If a game is unplayable, irrelevant, or has no valid thread, delete it everywhere and stop.
        const newPublicThreadId = getThreadId(gameInfo.playing);
        if (gameInfo.playing === 0 || gameInfo.description?.includes("envy") || gameInfo.description?.includes("require") || gameInfo.description?.includes("serverside") || !newPublicThreadId) {
            if (publicMessageId && publicThreadId) {
                const deleteUrl = `${FORUM_WEBHOOK_URL}/messages/${publicMessageId}?thread_id=${publicThreadId}`;
                fetch(deleteUrl, { method: 'DELETE' }).catch(err => console.error(`Error deleting public message ${publicMessageId} during filter cleanup:`, err));
            }
            if (moderationMessageId) {
                await deleteDiscordMessage(MODERATION_CHANNEL_ID, moderationMessageId);
            }
            await redis.del(gameKey);
            return response.status(200).json({ success: true, action: 'skipped_or_deleted' });
        }

        // --- State Determination ---
        const headers = { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT_AGENT_E };
        const isPublic = await redis.sismember(REDIS_KEYS.PUBLIC_GAMES_SET, universeId);
        const isModerationGame = gameInfo.playing > MODERATION_THRESHOLD;
        const wasModerationGame = !!moderationMessageId;

        // --- Moderation Logic ---
        if (isModerationGame) {
            const components = [{
                type: 1,
                components: [
                    isPublic
                        ? { type: 2, style: 4, label: 'Privatize', custom_id: `${DISCORD_CONSTANTS.PRIVATIZE_BUTTON_CUSTOM_ID}_${universeId}` }
                        : { type: 2, style: 3, label: 'Approve', custom_id: `${DISCORD_CONSTANTS.APPROVE_BUTTON_CUSTOM_ID}_${universeId}` }
                ]
            }];
            const moderationPayload = createDiscordEmbed(gameInfo, placeId, thumbnail, jobId, false, components);

            if (moderationMessageId) {
                const editSuccessful = await editDiscordMessage(MODERATION_CHANNEL_ID, moderationMessageId, moderationPayload);
                if (!editSuccessful) {
                    // If the edit fails (e.g., message was deleted), clear the ID to force recreation.
                    moderationMessageId = null;
                }
            }
            
            if (!moderationMessageId) { // If no message exists or the edit failed, create a new one.
                const responseData = await sendDiscordMessage(MODERATION_CHANNEL_ID, moderationPayload);
                if (responseData) {
                    moderationMessageId = responseData.id;
                }
            }
            // If the game just became a moderation game, we must delete its old public message.
            if (!wasModerationGame && publicMessageId && publicThreadId) {
                const deleteUrl = `${FORUM_WEBHOOK_URL}/messages/${publicMessageId}?thread_id=${publicThreadId}`;
                fetch(deleteUrl, { method: 'DELETE' }).catch(err => console.error(`Error deleting public message ${publicMessageId} on transition to moderation:`, err));
                publicMessageId = null;
                publicThreadId = null;
            }
        } else if (wasModerationGame && !isModerationGame) {
            // If the game drops below the player threshold, remove it from moderation.
            await deleteDiscordMessage(MODERATION_CHANNEL_ID, moderationMessageId);
            moderationMessageId = null;
        }

        // --- Public Logic ---
        // A game is only public if it's NOT a moderation game OR it has been explicitly approved.
        if (!isModerationGame || isPublic) {
            const publicPayload = createDiscordEmbed(gameInfo, placeId, thumbnail, jobId, false);
            
            // If the thread has changed, we must delete the old message and create a new one.
            if (publicMessageId && publicThreadId !== newPublicThreadId) {
                const deleteUrl = `${FORUM_WEBHOOK_URL}/messages/${publicMessageId}?thread_id=${publicThreadId}`;
                fetch(deleteUrl, { method: 'DELETE' }).catch(err => console.error(`Error deleting public message ${publicMessageId} during thread change:`, err));
                publicMessageId = null; 
            }

            if (publicMessageId) { // If thread is the same, just edit.
                const editUrl = `${FORUM_WEBHOOK_URL}/messages/${publicMessageId}?thread_id=${publicThreadId}`;
                const editResponse = await fetch(editUrl, { method: 'PATCH', headers, body: JSON.stringify(publicPayload) });
                if (!editResponse.ok && editResponse.status === 404) {
                    publicMessageId = null; // Message was deleted manually, so we'll recreate it.
                }
            }
            
            if (!publicMessageId) { // If no message exists (or was just deleted), create one.
                const createUrl = `${FORUM_WEBHOOK_URL}?wait=true&thread_id=${newPublicThreadId}`;
                const createResponse = await fetch(createUrl, { method: 'POST', headers, body: JSON.stringify(publicPayload) });
                if (createResponse.ok) {
                    const responseData = await createResponse.json();
                    publicMessageId = responseData.id;
                    publicThreadId = newPublicThreadId;
                } else {
                    console.error(`Discord API Error on POST: ${createResponse.status}`);
                }
            }
        }

        // --- Database Update ---
        const newGameData = {
            moderationMessageId,
            publicMessageId,
            publicThreadId,
            timestamp: currentTime,
            placeId: placeId,
            playerCount: gameInfo.playing,
            gameName: gameInfo.name
        };
        const pipeline = redis.pipeline();
        pipeline.set(gameKey, JSON.stringify(newGameData));
        pipeline.zadd(REDIS_KEYS.GAMES_BY_TIMESTAMP_ZSET, currentTime, gameKey);
        await pipeline.exec();

        return response.status(200).json({ success: true, publicMessageId, moderationMessageId });

    } catch (error) {
        console.error("Main Handler Error:", error);
        return response.status(500).send(`Internal Server Error: ${error.message}`);
    } finally {
        if (lockKey) await redis.del(lockKey);
    }
};
