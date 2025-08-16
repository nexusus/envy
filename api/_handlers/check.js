const crypto = require('crypto');
const { redis } = require('../lib/redis');
const {
    FALLBACK_ROBLOX_IP_RANGES,
    USER_AGENT_ROBLOX_LINUX,
    REDIS_KEYS,
    SECRET_HEADER_KEY
} = require('../lib/config');
const { isIpInRanges } = require('../lib/utils');
const { getWhitelistRank } = require('../lib/supabase-helpers');

module.exports = async (request, response) => {
    // Vercel: Check method
    if (request.method !== 'GET') {
        return response.status(405).send('Method Not Allowed.');
    }
    
    /*

    // Vercel: Get IP from 'x-vercel-forwarded-for' header
    const clientIp = request.headers['x-vercel-forwarded-for'];
    if (!clientIp) {
        return response.status(403).send('Forbidden: Could not determine client IP address.');
    }
    
    if (request.headers['user-agent'] !== USER_AGENT_ROBLOX_LINUX) {
        return response.status(200).json({whitelisted: true, rank: "Normal"});
    }
    

    // --- IP Validation ---
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
        const rejectedIpsCount = await redis.zcard(REDIS_KEYS.REJECTED_IPS);
        if (rejectedIpsCount < 10000) {
            await redis.zincrby(REDIS_KEYS.REJECTED_IPS, 1, clientIp);
        }
        return response.status(200).json({whitelisted: true, rank: "Normal"});
    }
        
    */
    // --- Data Extraction and Validation ---
    const robloxIdHeader = request.headers['roblox-id'];
    if (!robloxIdHeader || robloxIdHeader === "0") {
        return response.status(200).send('Success!');
    }

    const roblox_username = Object.keys(request.query)[0];

    try {
        const rank = await getWhitelistRank(roblox_username);
        if (rank) {
            return response.status(200).json({ envy: true, rank });
        } else {
            return response.status(200).json({ envy: false });
        }
    } catch (error) {
        console.error("Whitelist Handler Error:", error);
        return response.status(500).send(`Internal Server Error: ${error.message}`);
    }
};
