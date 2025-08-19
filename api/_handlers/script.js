const { redis } = require('../lib/redis');
const { isIpInRanges } = require('../lib/utils');
const { sendDiscordMessage } = require('../lib/discord-helpers');
const { FALLBACK_ROBLOX_IP_RANGES, REDIS_KEYS } = require('../lib/config');

const SCRIPT_LOG_CHANNEL = process.env.SCRIPT_LOG_CHANNEL;

module.exports = async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "I think you don't get it." });
    }

    const clientIp = req.headers['x-vercel-forwarded-for'];
    if (!clientIp) {
        return res.status(403).send('Where is your IP mate.');
    }

    const userAgent = req.headers['user-agent'];
    if (!userAgent || userAgent !== "Roblox/Linux") {
        return res.status(403).send('Hi, you are not allowed to do this.');
    }

    let activeIpRanges = FALLBACK_ROBLOX_IP_RANGES;
    try {
        const dynamicRangesJson = await redis.get(REDIS_KEYS.ROBLOX_IP_RANGES);
        if (dynamicRangesJson) activeIpRanges = JSON.parse(dynamicRangesJson);
    } catch (e) {
        console.error("Could not get IP list from Redis.", e);
    }
    const isIpFromRoblox = isIpInRanges(clientIp, activeIpRanges);
    if (!isIpFromRoblox) {
        console.warn(`Rejected request from non-Roblox IP: ${clientIp}`);
        await redis.zincrby(REDIS_KEYS.REJECTED_IPS, 1, clientIp);
        return res.status(403).send('Hello world, you are not allowed to do this.');
    }
    

    const { username = 'N/A', gameName = 'N/A', scriptPls = 'N/A' } = req.body;

    const embed = {
        title: "Envy Watcher | New Execution",
        color: parseInt("0x8200c8", 16),
        fields: [
            { name: "Username", value: `\`\`\`${username}\`\`\``, inline: true },
            { name: "Game Name", value: `\`\`\`${gameName}\`\`\``, inline: true },
            { name: "Script", value: `\`\`\`lua\n${scriptPls}\`\`\``, inline: false }
        ],
        footer: {
            text: "Envy Watcher | Script Execution Log. I love burgers."
        },
        timestamp: new Date().toISOString()
    };

    await sendDiscordMessage(SCRIPT_LOG_CHANNEL, { embeds: [embed] });

    res.status(200).send("OK");
};
