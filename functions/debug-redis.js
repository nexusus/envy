const { Redis } = require('ioredis');

exports.handler = async (event) => {
    
    let redis;
    let robloxIpData = null;
    let rejectedIpData = [];
    let errorMessage = null;

    try {
        redis = new Redis(process.env.AIVEN_VALKEY_URL, {
            tls: { servername: new URL(process.env.AIVEN_VALKEY_URL).hostname },
            connectTimeout: 5000
        });

        redis.on('error', (err) => { console.error('[ioredis] debug client error:', err); });
        
        robloxIpData = await redis.get('roblox_ip_ranges');
        const rejectedIpsRaw = await redis.zrevrange('rejected_ips', 0, 99, 'WITHSCORES');

        for (let i = 0; i < rejectedIpsRaw.length; i += 2) {
            rejectedIpData.push({ ip: rejectedIpsRaw[i], count: rejectedIpsRaw[i+1] });
        }
        await redis.quit();

    } catch (error) {
        errorMessage = error.toString();
        if (redis) { await redis.quit(); }
    }

    // Prepare the HTML response
    const responseBody = `<!DOCTYPE html>...`; // (The full HTML from before)

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: responseBody
    };
};
