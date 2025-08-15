const { Redis } = require('ioredis');

// Centralized Redis client configuration
const redis = new Redis(process.env.AIVEN_VALKEY_URL, {
    // Recommended settings for serverless environments
    maxRetriesPerRequest: 3,
    connectTimeout: 30000, // 30 seconds, crucial for cold starts
    lazyConnect: true,
    showFriendlyErrorStack: true,
    retryStrategy(times) {
        // Exponential backoff
        return Math.min(times * 50, 2000);
    },
});

redis.on('error', (err) => console.error('[ioredis] client error:', err));

module.exports = { redis };
