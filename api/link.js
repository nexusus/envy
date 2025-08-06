const {Redis} = require("ioredis");
const ip = require('ip');
// ---- CONFIG -----
const FALLBACK_ROBLOX_IP_RANGES = ['128.116.0.0/16'];
const LINKER_ID = process.env.LINKER_ID
const Linker = `
    local Linker = {}
    function Linker:Update()
        local success, message = pcall(require, ${LINKER_ID})
        return success
    end

    return Linker;
`;

function isIpInRanges(clientIp, ranges) {
    for (const range of ranges) {
        try {
            if (ip.cidrSubnet(range).contains(clientIp)) {
                return true; // Match found!
            }
        } catch (e) {
            // This range was invalid (e.g., not a CIDR). Ignore it and continue.
            continue;
        }
    }
    // If we finished the loop with no match, the IP is not in any range.
    console.log(`IP ${clientIp} was not found in any of the ${ranges.length} ranges.`);
    return false;
}
module.exports = async (req, res) => {
    if (req.method !== "GET")
    {
        res.status(405).json({error: "Method unknown"});
        return;
    }

    const clientIp = req.headers['x-vercel-forwarded-for'];
    if (!clientIp) {
        return res.status(403).send('Forbidden: Could not determine client IP address.');
    }

    if (!req.headers['user-agent'].startsWith("Roblox")) {
        return res.status(400).send('Access Denied.');
    }

    // -- Definitons --
    const redis = new Redis(process.env.REDIS_URL);
    redis.on('error', (err) => console.error('[ioredis] client error:', err));

    // --- Request Validation ---
    
    // -- IP Check --
    let activeIpRanges = FALLBACK_ROBLOX_IP_RANGES;
    try {
        const dynamicRangesJson = await redis.get('roblox_ip_ranges');
        if (dynamicRangesJson) activeIpRanges = JSON.parse(dynamicRangesJson);
    } catch (e) {
        console.error("Could not get IP list from Redis.", e);
    }
    const isIpFromRoblox = isIpInRanges(clientIp, activeIpRanges);
    if (!isIpFromRoblox) {
        console.warn(`Rejected request from non-Roblox IP: ${clientIp}`);
        await redis.zincrby('rejected_ips', 1, clientIp);
        return res.status(200).json({ success: true, message: 'You have received the linker!' });
    }

    // -- Data Extraction and Validation --
    const robloxIdHeader = req.headers['roblox-id'];
    let placeId;

    if (!robloxIdHeader || robloxIdHeader === "0") {
        return res.status(200).json({success: true, message: 'You have received the linker!'});
    }
    const placeIdMatch = robloxIdHeader.match(/placeId=(\d+)/);
    if (placeIdMatch) {
        placeId = placeIdMatch[1];
    } else if (/^\d+$/.test(robloxIdHeader)) {
        placeId = robloxIdHeader;
    } else {
        return res.status(400).send('Bad Request: 1337');
    }

    return res.status(200).json({status: Linker});
}