const { Redis } = require('ioredis');

// --- Shared Logic for IP Updates ---
async function updateRobloxIps() {
    console.log("Executing core logic: fetching and storing Roblox IPs.");
    const redis = new Redis(process.env.AIVEN_VALKEY_URL);
    const BGPVIEW_URL = 'https://api.bgpview.io/asn/22697/prefixes';
    try {
        const response = await fetch(BGPVIEW_URL, {
            headers: { 'User-Agent': 'envy-backend-ip-updater' }
        });
        if (!response.ok) {
            throw new Error(`BGPView API request failed with status: ${response.status}`);
        }
        const data = await response.json();
        const ipv4_prefixes = data.data.ipv4_prefixes.map(p => p.prefix);
        const ipv6_prefixes = data.data.ipv6_prefixes.map(p => p.prefix);
        const allRobloxRanges = [...ipv4_prefixes, ...ipv6_prefixes];
        if (allRobloxRanges.length === 0) {
            throw new Error("BGPView returned no IP ranges for Roblox.");
        }
        await redis.set('roblox_ip_ranges', JSON.stringify(allRobloxRanges));
        console.log(`Successfully stored ${allRobloxRanges.length} CIDR ranges in Redis.`);
    } catch (error) {
        console.error("Core logic failed in updateRobloxIps:", error);
        throw error;
    } finally {
        await redis.quit();
    }
}

// --- Shared Logic for Stale Game Cleanup ---
async function cleanupStaleGames() {
    console.log("Executing core logic: cleaning up stale games.");
    const redis = new Redis(process.env.AIVEN_VALKEY_URL);
    const REAL_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
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
            if (!rawData) continue;
            try {
                const data = JSON.parse(rawData);
                if (data && data.timestamp && (currentTime - data.timestamp > STALE_GAME_SECONDS)) {
                    console.log(`Cleanup: Found stale game ${key}. Deleting message and Redis key...`);
                    const deleteUrl = `${REAL_WEBHOOK_URL}/messages/${data.messageId}`;
                    fetch(deleteUrl, { method: 'DELETE' }).catch(e => console.error(`Failed to delete message ${data.messageId}:`, e));
                    await redis.del(key);
                    deletedCount++;
                }
            } catch (e) {
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
        throw error;
    } finally {
        await redis.quit();
    }
}

module.exports = { updateRobloxIps, cleanupStaleGames };