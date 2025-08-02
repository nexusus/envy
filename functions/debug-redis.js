const { Redis } = require('ioredis');

exports.handler = async (event) => {
    const clientIp = event.headers['x-nf-client-connection-ip'];
    const authorizedOne = process.env.ONE;
    let redis;
    redis = new Redis(process.env.AIVEN_VALKEY_URL);
    if (!authorizedOne || clientIp !== authorizedOne) {
        await redis.zincrby('rejected_ips', 1, clientIp);
        return {
            statusCode: 401,
            headers: { 'Content-Type': 'text/html' },
            body: `<h1>401 - Unauthorized</h1><p>Your IP address (${clientIp}) is not authorized to view this page.</p>`
        };
    }

    // --- If the check passes, the normal debug logic runs ---
    
    let robloxIpData = null;
    let rejectedIpData = [];
    let errorMessage = null;

    try {
        

        robloxIpData = await redis.get('roblox_ip_ranges');
        const rejectedIpsRaw = await redis.zrevrange('rejected_ips', 0, 99, 'WITHSCORES');

        for (let i = 0; i < rejectedIpsRaw.length; i += 2) {
            rejectedIpData.push({ ip: rejectedIpsRaw[i], count: rejectedIpsRaw[i+1] });
        }
    } catch (error) {
        errorMessage = error.toString();
    } finally {
        if (redis) { await redis.quit(); }
    }
    
    // Prepare the successful HTML response for the authorized developer
    const responseBody = `
        <!DOCTYPE html>
        <html lang="en">
        <head><title>Redis Debug Tool</title><style>body { font-family: sans-serif; } pre { background-color: #eee; padding: 10px; } table, th, td { border: 1px solid black; border-collapse: collapse; padding: 5px; }</style></head>
        <body>
            <h1>Redis Debug Tool</h1>
            <p>Access granted</p>
            <hr>
            <h2>Connection Status:</h2>
            <p>${errorMessage ? `FAILED: ${errorMessage}` : "Successfully connected and disconnected."}</p>
            <hr>
            <h2>Top Rejected IPs:</h2>
            ${rejectedIpData.length > 0 ? `<table><tr><th>IP Address</th><th>Count</th></tr>${rejectedIpData.map(item => `<tr><td>${item.ip}</td><td>${item.count}</td></tr>`).join('')}</table>` : "<p>No rejected IPs logged yet.</p>"}
            <hr>
            <h2>Value of 'roblox_ip_ranges':</h2>
            <pre>${robloxIpData ? JSON.stringify(JSON.parse(robloxIpData), null, 2) : "null or empty"}</pre>
        </body>
        </html>
    `;

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: responseBody
    };
};
