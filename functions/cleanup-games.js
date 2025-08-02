const { Redis } = require('ioredis');

async function cleanupStaleGames(redis, REAL_WEBHOOK_URL) {
    const STALE_GAME_SECONDS = 30 * 60; // 30 minutes
    const currentTime = Math.floor(Date.now() / 1000);
    let deletedCount = 0;
    
    try {
        const gameKeys = await redis.keys('game:*');
        if (gameKeys.length === 0) {
            console.log("Cleanup: No game keys found to process.");
            return;
        }
    
        const gameDataArray = await redis.mget(...gameKeys);
    
        for (let i = 0; i < gameKeys.length; i++) {
            const key = gameKeys[i];
            const rawData = gameDataArray[i];

            if(!rawData) continue;

            try {
                const data = JSON.parse(rawData);
                if (data && data.timestamp && (currentTime - data.timestamp > STALE_GAME_SECONDS)) {
                    console.log(`Cleanup: Found stale game ${key}. Deleting message and Redis key...`);
                    const deleteUrl = `${REAL_WEBHOOK_URL}/messages/${data.messageId}`;
                    // Fire and forget deletion, but log errors
                    fetch(deleteUrl, { method: 'DELETE' }).catch(e => console.error(`Failed to delete message ${data.messageId}:`, e));
                    await redis.del(key);
                    deletedCount++;
                }
            } catch(e) {
                console.error(`Cleanup: Failed to parse or process data for key ${key}:`, rawData, e);
            }
        }
        if (deletedCount > 0) {
            console.log(`Cleanup complete. Deleted ${deletedCount} stale game(s).`);
        } else {
            console.log("Cleanup complete. No stale games were found.");
        }
    } catch (error) {
        console.error("Background Cleanup Error:", error);
        throw error; // Propagate error to the handler
    }
}

// Netlify Scheduled Function Handler
exports.handler = async () => {
    console.log("Running scheduled job: cleanupStaleGames");
    const redis = new Redis(process.env.AIVEN_VALKEY_URL);
    const REAL_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
    
    try {
        await cleanupStaleGames(redis, REAL_WEBHOOK_URL);
        return {
            statusCode: 200,
            body: "Cleanup job executed successfully."
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: "Cleanup job failed."
        };
    }
};
