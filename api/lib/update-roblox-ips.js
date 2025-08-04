const { Redis } = require('ioredis');

const BGPVIEW_URL = 'https://api.bgpview.io/asn/22697/prefixes';

// This is the self-contained, reusable function.
async function updateRobloxIps() {
    console.log("Executing core logic: fetching and storing Roblox IPs.");
    
    // Connect to Redis using the secure TLS settings.
    const redis = new Redis(process.env.AIVEN_VALKEY_URL);

    redis.on('error', (err) => {
      console.error('[ioredis] client error in updateRobloxIps:', err);
    });

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

        // Store the data in Redis.
        await redis.set('roblox_ip_ranges', JSON.stringify(allRobloxRanges));
        console.log(`Successfully stored ${allRobloxRanges.length} CIDR ranges in Redis.`);
        
    } catch (error) {
        console.error("Core logic failed in updateRobloxIps:", error);
        // Re-throw the error so the calling function knows it failed.
        throw error;
    } finally {
        // Always disconnect from Redis cleanly, even if there was an error.
        await redis.quit();
    }
}
module.exports = { updateRobloxIps };
