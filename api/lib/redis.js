const { Redis } = require('ioredis');

// Centralized Redis client configuration
const redis = new Redis(process.env.AIVEN_VALKEY_URL, {
  // Recommended settings for serverless environments
  maxRetriesPerRequest: 3,
  connectTimeout: 10000, // 10 seconds
  lazyConnect: true, // Don't connect until the first command is sent
  enableOfflineQueue: false, // Fail fast if the connection is down
});

redis.on('error', (err) => console.error('[ioredis] client error:', err));

module.exports = { redis };