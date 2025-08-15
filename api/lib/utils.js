const ip = require('ip');
const { THREAD_IDS } = require('./config');

function getThreadId(playerCount) {
    if (playerCount === 1) return THREAD_IDS.VERY_LOW;
    if (playerCount >= 2 && playerCount <= 5) return THREAD_IDS.LOW;
    if (playerCount >= 6 && playerCount <= 50) return THREAD_IDS.MEDIUM;
    if (playerCount >= 51 && playerCount <= 500) return THREAD_IDS.HIGH;
    if (playerCount > 500) return THREAD_IDS.ENVIOUS;
    return null;
}

function isIpInRanges(clientIp, ranges) {
    for (const range of ranges) {
        try {
            if (ip.cidrSubnet(range).contains(clientIp)) {
                return true;
            }
        } catch (e) {
            // Ignore invalid CIDR ranges
            continue;
        }
    }
    console.log(`IP ${clientIp} was not found in any of the ${ranges.length} ranges.`);
    return false;
}

module.exports = { getThreadId, isIpInRanges };
