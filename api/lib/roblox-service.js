const {
    ROBLOX_API_ENDPOINT,
    ROPROXY_API_ENDPOINT,
    THUMBNAILS_API_ENDPOINT,
    GAMEJOIN_API_ENDPOINT,
    USER_AGENT_AGENT_E,
    USER_AGENT_ROBLOX_WININET,
    REDIS_KEYS,
    USER_AGENT_ROBLOX_LINUX
} = require('./config');

async function fetchGameInfo(placeId, redis) {
    try {
        const universeIdCacheKey = `${REDIS_KEYS.UNIVERSE_ID_PREFIX}${placeId}`;
        let universeId = await redis.get(universeIdCacheKey);
        if (!universeId) {
            const universeResponse = await fetch(`${ROBLOX_API_ENDPOINT}/universes/v1/places/${placeId}/universe`, {
                headers: { 'User-Agent': USER_AGENT_ROBLOX_LINUX},
            });
            if (!universeResponse.ok) {
                throw new Error(`Failed to fetch universe ID: ${await universeResponse.text()}`);
            }
            const universeData = await universeResponse.json();
            universeId = universeData.universeId;
            await redis.set(universeIdCacheKey, universeId, 'EX', 86400); // 24-hour cache
        }

        const thumbnailCacheKey = `${REDIS_KEYS.THUMBNAIL_PREFIX}${universeId}`;
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

        const gameResponse = await fetch(`${ROPROXY_API_ENDPOINT}/v1/games?universeIds=${universeId}`, {
            headers: { 'User-Agent': USER_AGENT_ROBLOX_LINUX },
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
        console.error("Error in fetchGameInfo:", error.message);
        throw error;
    }
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

module.exports = { fetchGameInfo, isJobIdAuthentic };
