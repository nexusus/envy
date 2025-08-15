const { verifyKey, InteractionType, InteractionResponseType, InteractionResponseFlags } = require('discord-interactions');
const { redis } = require('../lib/redis');
const { deleteDiscordMessage } = require('../lib/discord-helpers');
const { DISCORD_CONSTANTS, COOLDOWN_SECONDS } = require('../lib/config');
const { GAMES_COMMAND_NAME, APPROVE_BUTTON_CUSTOM_ID, PRIVATIZE_BUTTON_CUSTOM_ID } = DISCORD_CONSTANTS;

// --- Initialization ---
// Create the Redis client once, outside the handler, to be reused across invocations.

// --- Main Handler ---
module.exports = async (request, response) => {
    // 1. Verify the request is from Discord
    const signature = request.headers['x-signature-ed25519'];
    const timestamp = request.headers['x-signature-timestamp'];
    const rawBody = JSON.stringify(request.body);

    const isValidRequest = verifyKey(
        Buffer.from(rawBody),
        signature,
        timestamp,
        process.env.DISCORD_PUBLIC_KEY
    );

    if (!isValidRequest) {
        console.error('Invalid request signature');
        return response.status(401).send('Bad request signature');
    }

    // 2. Handle the interaction type
    const interaction = request.body;
    switch (interaction.type) {
        case InteractionType.PING:
            // The PING message is used during the initial webhook validation.
            return response.status(200).json({ type: InteractionResponseType.PONG });

        case InteractionType.APPLICATION_COMMAND:
            // Handle slash commands
            if (interaction.data.name === GAMES_COMMAND_NAME) {
                // Immediately defer the response to Discord.
                response.status(200).json({
                    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
                    data: { flags: InteractionResponseFlags.EPHEMERAL },
                });

                // --- Fire-and-forget background processing ---
                (async () => {
                    const userId = interaction.member.user.id;
                    const cooldownKey = `cooldown:${GAMES_COMMAND_NAME}:${userId}`;
                    const followUpUrl = `https://discord.com/api/v10/webhooks/${process.env.DISCORD_APP_ID}/${interaction.token}/messages/@original`;

                    try {
                        const onCooldown = await redis.get(cooldownKey);
                        if (onCooldown) {
                            await fetch(followUpUrl, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ content: `You're on cooldown! Please wait a moment.` }),
                            });
                            return;
                        }

                        const gameCount = await redis.zcard('games_by_timestamp');
                        if (gameCount === 0) {
                            await fetch(followUpUrl, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ content: 'No game data available right now.' }),
                            });
                            return;
                        }

                        // Fetch all game keys and their scores (timestamps)
                        const gameKeysWithScores = await redis.zrevrange('games_by_timestamp', 0, -1, 'WITHSCORES');
                        const gameKeys = gameKeysWithScores.filter((_, i) => i % 2 === 0);

                        let totalPlayers = 0;
                        let highestPlayerCount = 0;

                        if (gameKeys.length > 0) {
                            const gameDataRaw = await redis.mget(...gameKeys);
                            gameDataRaw.forEach(raw => {
                                if (raw) {
                                    try {
                                        const data = JSON.parse(raw);
                                        totalPlayers += data.playerCount || 0;
                                        if (data.playerCount > highestPlayerCount) {
                                            highestPlayerCount = data.playerCount;
                                        }
                                    } catch (e) {
                                        console.error("Failed to parse game data for stats:", raw);
                                    }
                                }
                            });
                        }

                        await redis.set(cooldownKey, 'true', 'EX', COOLDOWN_SECONDS);

                        await fetch(followUpUrl, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                embeds: [{
                                    title: "📊 Game Statistics",
                                    color: parseInt("0x8200c8", 16),
                                    fields: [
                                        { name: "Total Games", value: `\`${gameCount}\``, inline: true },
                                        { name: "Total Players", value: `\`${totalPlayers.toLocaleString()}\``, inline: true },
                                        { name: "Highest Player Count", value: `\`${highestPlayerCount.toLocaleString()}\``, inline: true },
                                    ],
                                    footer: { text: "Envy Serverside" },
                                    timestamp: new Date().toISOString(),
                                }],
                            }),
                        });
                    } catch (error) {
                        console.error("Error handling /games command:", error);
                        await fetch(followUpUrl, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ content: 'An error occurred while fetching game statistics.' }),
                        });
                    }
                })(); // Self-invoking async function
            }
            break;

        case InteractionType.MESSAGE_COMPONENT:
            // Handle button clicks
            const customId = interaction.data.custom_id;
            if (customId.startsWith(APPROVE_BUTTON_CUSTOM_ID) || customId.startsWith(PRIVATIZE_BUTTON_CUSTOM_ID)) {
                // Permissions check: only allow administrators
                const permissions = interaction.member.permissions;
                const isAdmin = (BigInt(permissions) & 8n) === 8n; // 8n is the bitfield for Administrator

                if (!isAdmin) {
                    return response.status(200).json({
                        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                        data: {
                            content: "You don't have permission to use this button.",
                            flags: InteractionResponseFlags.EPHEMERAL,
                        },
                    });
                }

                console.log(`[LOG] MESSAGE_COMPONENT received: ${customId}`);
                const universeId = customId.split('_')[2];
                const isApproving = customId.startsWith(APPROVE_BUTTON_CUSTOM_ID);
                const gameKey = `game:${universeId}`;

                // Defer the response immediately to show the loading state on the button.
                response.status(200).json({
                    type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE,
                });

                // --- Fire-and-forget background processing ---
                (async () => {
                    const followUpUrl = `https://discord.com/api/v10/webhooks/${process.env.DISCORD_APP_ID}/${interaction.token}/messages/@original`;
                    try {
                        console.log(`[LOG] Processing action: isApproving=${isApproving}, universeId=${universeId}`);
                        if (isApproving) {
                            await redis.sadd('public_games', universeId);
                            console.log(`[LOG] Added ${universeId} to public_games`);
                        } else {
                            await redis.srem('public_games', universeId);
                            console.log(`[LOG] Removed ${universeId} from public_games`);

                            const rawGameData = await redis.get(gameKey);
                            if (rawGameData) {
                                const gameData = JSON.parse(rawGameData);
                                if (gameData.publicMessageId && gameData.publicThreadId) {
                                    const wasDeleted = await deleteDiscordMessage(gameData.publicThreadId, gameData.publicMessageId);
                                    if (wasDeleted) {
                                        console.log(`[LOG] Successfully deleted public message ${gameData.publicMessageId}`);
                                    } else {
                                        console.error(`[ERROR] Failed to delete public message ${gameData.publicMessageId}. The helper function already logged the details.`);
                                    }

                                    gameData.publicMessageId = null;
                                    gameData.publicThreadId = null;
                                    await redis.set(gameKey, JSON.stringify(gameData));
                                    console.log(`[LOG] Cleared public message data for ${universeId}`);
                                }
                            }
                        }

                        const newButton = isApproving
                            ? { type: 2, style: 1, label: 'Privatize', custom_id: `${PRIVATIZE_BUTTON_CUSTOM_ID}_${universeId}` }
                            : { type: 2, style: 3, label: 'Approve', custom_id: `${APPROVE_BUTTON_CUSTOM_ID}_${universeId}` };

                        await fetch(followUpUrl, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                content: interaction.message.content,
                                embeds: interaction.message.embeds,
                                components: [{ type: 1, components: [newButton] }],
                            }),
                        });

                    } catch (error) {
                        console.error("[ERROR] Unhandled exception in button handler:", error);
                        await fetch(followUpUrl, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                content: 'An unexpected error occurred. This is likely a database connection issue.',
                                flags: InteractionResponseFlags.EPHEMERAL,
                            }),
                        });
                    }
                })(); // Self-invoking async function
            } else {
                console.warn(`[WARN] Unhandled button custom_id: ${customId}`);
                return response.status(200).json({
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: {
                        content: "This button is either unrecognized or has expired.",
                        flags: InteractionResponseFlags.EPHEMERAL,
                    },
                });
            }
            break;

        default:
            console.warn(`Unhandled interaction type: ${interaction.type}`);
            return response.status(400).send('Unhandled interaction type');
    }

    // Fallback for unhandled cases
    return response.status(400).send('Bad Request');
};
