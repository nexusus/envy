const { Redis } = require('ioredis');

// --- Shared Logic for IP Updates ---
const { Redis } = require('ioredis');

const BGPVIEW_URL = 'https://api.bgpview.io/asn/22697/prefixes'; // Roblox ASN
const AWS_IP_RANGES_URL = 'https://ip-ranges.amazonaws.com/ip-ranges.json';

async function updateRobloxIps() {
    console.log("Executing SECURE core logic: fetching Roblox ASN and specific AWS service IPs.");
    const redis = new Redis(process.env.AIVEN_VALKEY_URL);

    try {
        const [robloxResponse, awsResponse] = await Promise.all([
            fetch(BGPVIEW_URL, { headers: { 'User-Agent': 'envy-backend-ip-updater' } }),
            fetch(AWS_IP_RANGES_URL)
        ]);

        if (!robloxResponse.ok) throw new Error(`BGPView API request failed: ${robloxResponse.status}`);
        if (!awsResponse.ok) throw new Error(`AWS IP Ranges request failed: ${awsResponse.status}`);

        const robloxData = await robloxResponse.json();
        const awsData = await awsResponse.json();

        // --- 1. Process Roblox IPs ---
        const roblox_ipv4 = robloxData.data.ipv4_prefixes.map(p => p.prefix);
        const roblox_ipv6 = robloxData.data.ipv6_prefixes.map(p => p.prefix);
        const allRobloxRanges = [...roblox_ipv4, ...roblox_ipv6];
        console.log(`Fetched ${allRobloxRanges.length} CIDR ranges from Roblox ASN.`);

        // --- 2. Process AWS IPs with SECURE filtering ---
        const aws_ipv4 = awsData.prefixes
            .filter(p => p.service === 'AMAZON') 
            .map(p => p.ip_prefix);

        const aws_ipv6 = awsData.ipv6_prefixes
            .filter(p => p.service === 'AMAZON')
            .map(p => p.ipv6_ip_prefix);

        const filteredAwsRanges = [...aws_ipv4, ...aws_ipv6];
        console.log(`Fetched and filtered ${filteredAwsRanges.length} CIDR ranges from AWS (service: AMAZON). Total AWS ranges were ${awsData.prefixes.length + awsData.ipv6_prefixes.length}.`);

        // --- 3. Combine both lists ---
        const combinedIpRanges = [...allRobloxRanges, ...filteredAwsRanges];

        if (combinedIpRanges.length < 500) {
            throw new Error("Combined IP list seems too small after filtering. Aborting update.");
        }

        await redis.set('roblox_ip_ranges', JSON.stringify(combinedIpRanges));
        console.log(`Successfully stored a combined total of ${combinedIpRanges.length} CIDR ranges in Redis.`);

    } catch (error) {
        console.error("Core logic failed in updateRobloxAndAwsIps:", error);
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