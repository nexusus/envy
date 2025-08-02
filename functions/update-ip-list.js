const { Redis } = require('ioredis');

// Use the BGPView API to get all IP prefixes registered to Roblox's network (AS22697)
const BGPVIEW_URL = 'https://api.bgpview.io/asn/22697/prefixes';

exports.handler = async () => {
    console.log("Running scheduled job: fetching Roblox IP list from BGPView.");
    const redis = new Redis(process.env.AIVEN_VALKEY_URL);

    try {
        const response = await fetch(BGPVIEW_URL, {
            headers: { 'User-Agent': 'envy-backend-ip-updater' }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch IP ranges from BGPView. Status: ${response.status}`);
        }
        
        const data = await response.json();
        const ipv4_prefixes = data.data.ipv4_prefixes.map(p => p.prefix);
        const ipv6_prefixes = data.data.ipv6_prefixes.map(p => p.prefix);
        const allRobloxRanges = [...ipv4_prefixes, ...ipv6_prefixes];

        if (allRobloxRanges.length === 0) {
            throw new Error("BGPView returned no IP ranges for Roblox.");
        }

        await redis.set('roblox_ip_ranges', JSON.stringify(allRobloxRanges));
        console.log(`Successfully updated Roblox IP list with ${allRobloxRanges.length} CIDR ranges.`);

        return {
            statusCode: 200,
            body: `Successfully updated with ${allRobloxRanges.length} ranges.`
        };

    } catch (error) {
        console.error("Failed to update Roblox IP list:", error);
        return { statusCode: 500, body: "Failed to update IP list." };
    }
};
