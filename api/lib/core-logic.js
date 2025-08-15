const { Redis } = require('ioredis');
const {
    FORUM_WEBHOOK_URL,
    REDIS_KEYS,
    BGPVIEW_URL,
    AWS_IP_RANGES_URL
} = require('./config');

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

        await redis.set(REDIS_KEYS.ROBLOX_IP_RANGES, JSON.stringify(combinedIpRanges));
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
    console.log("Starting stale game cleanup process...");
    const redis = new Redis(process.env.AIVEN_VALKEY_URL);
    const FORUM_WEBHOOK_URL = process.env.FORUM_WEBHOOK_URL;
    const STALE_GAME_SECONDS = 30 * 60; // 30 minutes
    const currentTime = Math.floor(Date.now() / 1000);
    const staleThreshold = currentTime - STALE_GAME_SECONDS;
    const trackingSetKey = 'games_by_timestamp';
    let deletedCount = 0;

    try {
        // Fetch stale game keys from the sorted set. This is much more efficient than KEYS.
        const staleGameKeys = await redis.zrangebyscore(trackingSetKey, 0, staleThreshold);
        console.log(`Found ${staleGameKeys.length} games to check for staleness.`);

        if (staleGameKeys.length === 0) {
            console.log("Cleanup: No stale games found to process.");
            return;
        }

        const gameDataArray = await redis.mget(...staleGameKeys);
        const pipeline = redis.pipeline();

        for (let i = 0; i < staleGameKeys.length; i++) {
            const key = staleGameKeys[i];
            const rawData = gameDataArray[i];
            
            if (!rawData) {
                console.log(`Skipping game ${key} due to empty data, removing from tracking set.`);
                pipeline.zrem(trackingSetKey, key); // Clean up from sorted set
                continue;
            }

            try {
                const data = JSON.parse(rawData);
                const deleteUrl = `${FORUM_WEBHOOK_URL}/messages/${data.messageId}?thread_id=${data.threadId}`;
                
                console.log(`Game ${key} is stale. Attempting to delete Discord message ${data.messageId}...`);
                const deleteResponse = await fetch(deleteUrl, { method: 'DELETE' });

                // Proceed if Discord confirms the deletion (204 No Content) or if the message was already gone (404 Not Found)
                if (deleteResponse.ok || deleteResponse.status === 404) {
                    console.log(`Discord message ${data.messageId} deleted or already gone. Removing game from database.`);
                    // Add deletion commands to the pipeline ONLY if Discord confirmation is received
                    pipeline.del(key);
                    pipeline.zrem(trackingSetKey, key);
                    deletedCount++;
                } else {
                    // If Discord returns an error (e.g., rate limit, server error), we log it and do NOT delete the game data.
                    // This allows the job to retry on the next run.
                    console.error(`Failed to delete Discord message ${data.messageId}. Status: ${deleteResponse.status}. Game data will be kept for the next retry.`);
                }
            } catch (e) {
                console.error(`Error processing game ${key}. Raw data: "${rawData}". Error:`, e);
                // If the data is corrupt and cannot be parsed, we should remove it from the tracking set to prevent it from causing errors on every run.
                pipeline.zrem(trackingSetKey, key);
            }
        }

        // Execute all deletions in a single atomic operation
        await pipeline.exec();

        if (deletedCount > 0) {
            console.log(`Cleanup complete. Deleted ${deletedCount} stale game(s) from the database.`);
        } else {
            console.log("Cleanup complete. No stale games needed to be deleted from the database.");
        }
    } catch (error) {
        console.error("An unexpected error occurred during the cleanup process:", error);
        throw error; // Re-throw to indicate failure
    } finally {
        console.log("Closing Redis connection.");
        await redis.quit();
    }
}

// --- Comprehensive Discord Message Cleanup ---
async function cleanupOrphanedMessages() {
    console.log("Starting comprehensive cleanup of orphaned Discord messages...");
    const FORUM_WEBHOOK_URL = process.env.FORUM_WEBHOOK_URL;
    // This is a critical assumption about the webhook URL structure.
    const WEBHOOK_ID = FORUM_WEBHOOK_URL.split('/')[5]; 
    const STALE_MESSAGE_MINUTES = 30;
    const staleTimestamp = Date.now() - (STALE_MESSAGE_MINUTES * 60 * 1000);
    let deletedCount = 0;

    const threadIds = [
        process.env.THREAD_ID_VERY_LOW,
        process.env.THREAD_ID_LOW,
        process.env.THREAD_ID_MEDIUM,
        process.env.THREAD_ID_HIGH,
        process.env.THREAD_ID_ENVIOUS
    ].filter(id => id); // Filter out any undefined/empty IDs

    if (!WEBHOOK_ID) {
        console.error("Could not extract webhook ID from FORUM_WEBHOOK_URL. Skipping orphaned message cleanup.");
        return;
    }
    
    if (!process.env.DISCORD_BOT_TOKEN) {
        console.error("DISCORD_BOT_TOKEN is not set. Skipping orphaned message cleanup as it's required to list messages.");
        return;
    }

    for (const threadId of threadIds) {
        try {
            // Webhooks cannot list messages, so we must use the standard Discord Bot API endpoint.
            const messagesUrl = `https://discord.com/api/v10/channels/${threadId}/messages?limit=100`;
            const response = await fetch(messagesUrl, {
                headers: { 'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}` }
            });

            if (!response.ok) {
                console.error(`Failed to fetch messages from thread ${threadId}. Status: ${response.status}. Body: ${await response.text()}`);
                continue; // Skip to the next thread
            }

            const messages = await response.json();
            
            for (const message of messages) {
                // Check if the message is from our specific webhook and is older than the stale threshold.
                if (message.webhook_id === WEBHOOK_ID && new Date(message.timestamp).getTime() < staleTimestamp) {
                    console.log(`Found orphaned/stale message ${message.id} in thread ${threadId}. Deleting...`);
                    // We use the webhook here to delete the message, as it's generally more reliable for messages created by it.
                    const deleteUrl = `${FORUM_WEBHOOK_URL}/messages/${message.id}?thread_id=${threadId}`;
                    const deleteResponse = await fetch(deleteUrl, { method: 'DELETE' });
                    
                    if (deleteResponse.ok || deleteResponse.status === 404) {
                        deletedCount++;
                    } else {
                        console.error(`Failed to delete stale message ${message.id}. Status: ${deleteResponse.status}`);
                    }
                }
            }
        } catch (error) {
            console.error(`An error occurred while cleaning up thread ${threadId}:`, error);
        }
    }

    if (deletedCount > 0) {
        console.log(`Comprehensive cleanup complete. Deleted ${deletedCount} orphaned/stale message(s) from Discord.`);
    } else {
        console.log("Comprehensive cleanup complete. No orphaned/stale messages were found to delete.");
    }
}

module.exports = { updateRobloxIps, cleanupStaleGames, cleanupOrphanedMessages };
