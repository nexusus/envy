const { verifyKey, InteractionType, InteractionResponseType, InteractionResponseFlags } = require('discord-interactions');
const { Redis } = require('ioredis');
const { DISCORD_CONSTANTS, COOLDOWN_SECONDS } = require('./lib/config');
const { GAMES_COMMAND_NAME, APPROVE_BUTTON_CUSTOM_ID, PRIVATIZE_BUTTON_CUSTOM_ID } = DISCORD_CONSTANTS;

// --- Initialization ---
const redis = new Redis(process.env.AIVEN_VALKEY_URL);

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
                const userId = interaction.member.user.id;
                const cooldownKey = `cooldown:${GAMES_COMMAND_NAME}:${userId}`;

                // Immediately defer the response
                response.status(200).json({
                    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
                    data: {
                        flags: InteractionResponseFlags.EPHEMERAL,
                    },
                });

                const onCooldown = await redis.get(cooldownKey);
                if (onCooldown) {
                    await fetch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_APP_ID}/${interaction.token}/messages/@original`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            content: `You're on cooldown! Please wait a moment before using this command again.`,
                        }),
                    });
                    return;
                }

                try {
                    const gameKeys = await redis.zrange('games_by_timestamp', 0, -1);
                    if (gameKeys.length === 0) {
                        await fetch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_APP_ID}/${interaction.token}/messages/@original`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ content: 'No game data available right now.' }),
                        });
                        return;
                    }

                    const gameDataRaw = await redis.mget(...gameKeys);
                    let totalPlayers = 0;
                    let highestPlayerCount = 0;

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

                    await redis.set(cooldownKey, 'true', 'EX', COOLDOWN_SECONDS);

                    await fetch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_APP_ID}/${interaction.token}/messages/@original`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            embeds: [{
                                title: "📊 Game Statistics",
                                color: parseInt("0x8200c8", 16),
                                fields: [
                                    { name: "Total Games", value: `\`${gameKeys.length}\``, inline: true },
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
                    await fetch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_APP_ID}/${interaction.token}/messages/@original`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ content: 'An error occurred while fetching game statistics.' }),
                    });
                }
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

                const universeId = customId.split('_')[2];
                const isApproving = customId.startsWith(APPROVE_BUTTON_CUSTOM_ID);
                const gameKey = `game:${universeId}`;

                try {
                    if (isApproving) {
                        await redis.sadd('public_games', universeId);
                    } else {
                        await redis.srem('public_games', universeId);
                        
                        // When privatizing, we must immediately delete the public message.
                        const rawGameData = await redis.get(gameKey);
                        if (rawGameData) {
                            const gameData = JSON.parse(rawGameData);
                            if (gameData.publicMessageId && gameData.publicThreadId) {
                                const deleteUrl = `${process.env.FORUM_WEBHOOK_URL}/messages/${gameData.publicMessageId}?thread_id=${gameData.publicThreadId}`;
                                fetch(deleteUrl, { method: 'DELETE' }).catch(err => console.error(`Error deleting public message ${gameData.publicMessageId} on privatize:`, err));
                                
                                // Remove public data from Redis to prevent re-creation
                                gameData.publicMessageId = null;
                                gameData.publicThreadId = null;
                                await redis.set(gameKey, JSON.stringify(gameData));
                            }
                        }
                    }

                    // Update the button on the original message
                    const newButton = isApproving ? {
                        type: 2, style: 4, label: 'Privatize', custom_id: `${PRIVATIZE_BUTTON_CUSTOM_ID}_${universeId}`
                    } : {
                        type: 2, style: 3, label: 'Approve', custom_id: `${APPROVE_BUTTON_CUSTOM_ID}_${universeId}`
                    };
                    
                    const updatedMessage = {
                        ...interaction.message,
                        components: [{ type: 1, components: [newButton] }],
                    };

                    return response.status(200).json({
                        type: InteractionResponseType.UPDATE_MESSAGE,
                        data: updatedMessage,
                    });

                } catch (error) {
                    console.error("Error handling button interaction:", error);
                    return response.status(200).json({
                        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                        data: {
                            content: 'An error occurred while processing this action.',
                            flags: InteractionResponseFlags.EPHEMERAL,
                        },
                    });
                }
            }
            break;

        default:
            console.warn(`Unhandled interaction type: ${interaction.type}`);
            return response.status(400).send('Unhandled interaction type');
    }

    // Fallback for unhandled cases
    return response.status(400).send('Bad Request');
};
