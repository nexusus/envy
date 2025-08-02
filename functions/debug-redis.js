const { Redis } = require('ioredis');

exports.handler = async () => {
    console.log("Running debug function...");

    let redis;
    let redisData = null;
    let errorMessage = null;

    try {
        redis = new Redis(process.env.AIVEN_VALKEY_URL);

        redis.on('error', (err) => {
          // This won't be caught by the try/catch, but it will log
          console.error('[ioredis] debug client error:', err);
        });

        console.log("Debug function connected to Redis. Getting key...");
        redisData = await redis.get('roblox_ip_ranges');
        console.log("Successfully got data from Redis.");
        await redis.quit();

    } catch (error) {
        console.error("Debug function failed:", error);
        errorMessage = error.toString();
        if (redis) {
            await redis.quit();
        }
    }

    // Prepare a clean response for the browser
    const responseBody = `
        <h1>Redis Debug Tool</h1>
        <hr>
        <h2>Connection Status:</h2>
        <p>${errorMessage ? `FAILED: ${errorMessage}` : "Successfully connected and disconnected."}</p>
        <hr>
        <h2>Value of 'roblox_ip_ranges':</h2>
        <pre style="background-color: #eee; padding: 10px; border-radius: 5px; white-space: pre-wrap; word-wrap: break-word;">${redisData ? JSON.stringify(JSON.parse(redisData), null, 2) : "null or empty"}</pre>
    `;

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: responseBody
    };
};
