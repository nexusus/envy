// api/cleanup.js - Scheduled Cron Job for deleting stale entries

import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
    // --- Security Check: Ensure this is a Vercel Cron Job ---
    // This secret must be set in your Vercel Environment Variables
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).send('Unauthorized');
    }

    const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    const REAL_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
    const STALE_GAME_SECONDS = 2 * 60 * 60; // 2 hours
    const currentTime = Math.floor(Date.now() / 1000);
    let deletedCount = 0;

    try {
        // Scan for all game keys in the database
        const gameKeys = await redis.keys('game:*');
        if (gameKeys.length === 0) {
            return res.status(200).send('No game keys to process.');
        }

        // Get all game data objects in one pipeline for efficiency
        const pipeline = redis.pipeline();
        gameKeys.forEach(key => pipeline.get(key));
        const gameDataArray = await pipeline.exec();

        for (let i = 0; i < gameKeys.length; i++) {
            const key = gameKeys[i];
            const data = gameDataArray[i];

            if (data && data.timestamp && (currentTime - data.timestamp > STALE_GAME_SECONDS)) {
                console.log(`Found stale game ${key}. Deleting...`);
                
                // 1. Delete the Discord message
                const deleteUrl = `${REAL_WEBHOOK_URL}/messages/${data.messageId}`;
                fetch(deleteUrl, { method: 'DELETE' });

                // 2. Delete the entry from the database
                await redis.del(key);
                deletedCount++;
            }
        }
        
        const message = `Cleanup complete. Deleted ${deletedCount} stale game(s).`;
        console.log(message);
        return res.status(200).send(message);

    } catch (error) {
        console.error("Cleanup Cron Job Error:", error);
        return res.status(500).send(`Internal Server Error: ${error.message}`);
    }
}
