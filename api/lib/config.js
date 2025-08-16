// --- Environment Variable Validation ---
const REQUIRED_ENV_VARS = [
    'AIVEN_VALKEY_URL',
    'SECRET_HEADER_KEY',
    'THREAD_ID_VERY_LOW',
    'THREAD_ID_LOW',
    'THREAD_ID_MEDIUM',
    'THREAD_ID_HIGH',
    'THREAD_ID_ENVIOUS',
    'DISCORD_PUBLIC_KEY',
    'DISCORD_APP_ID',
    'DISCORD_BOT_TOKEN',
    'MODERATION_CHANNEL_ID'
];

for (const envVar of REQUIRED_ENV_VARS) {
    if (!process.env[envVar]) {
        // In a serverless environment, throwing an error is a good way to halt execution on a critical misconfiguration.
        throw new Error(`Missing required environment variable: ${envVar}`);
    }
}

// --- CONFIGURATION ---
const MAX_DESCRIPTION_LENGTH = parseInt(process.env.MAX_DESCRIPTION_LENGTH, 10) || 500;
const FALLBACK_ROBLOX_IP_RANGES = ('128.116.0.0/16').split(',');
const AUTH_CACHE_EXPIRATION_SECONDS = 300;
const MODERATION_THRESHOLD = 99;
const COOLDOWN_SECONDS = 30;

// --- API Endpoints ---
const ROBLOX_API_ENDPOINT = 'https://apis.roblox.com';
const ROPROXY_API_ENDPOINT = 'https://games.roproxy.com';
const THUMBNAILS_API_ENDPOINT = 'https://thumbnails.roblox.com';
const GAMEJOIN_API_ENDPOINT = 'https://gamejoin.roblox.com';
const BGPVIEW_URL = 'https://api.bgpview.io/asn/22697/prefixes';
const AWS_IP_RANGES_URL = 'https://ip-ranges.amazonaws.com/ip-ranges.json';

// --- User Agents ---
const USER_AGENT_AGENT_E = 'Agent-E';
const USER_AGENT_ROBLOX_LINUX = 'Roblox/Linux';

// --- Redis Keys ---
const REDIS_KEYS = {
    LOCK_GAME_PREFIX: 'lock:game:',
    GAME_PREFIX: 'game:',
    THUMBNAIL_PREFIX: 'thumbnail:',
    UNIVERSE_ID_PREFIX: 'universe_id:',
    AUTH_PREFIX: 'auth:',
    AUTH_ATTEMPT_PREFIX: 'auth_attempt:',
    RATE_PREFIX: 'rate:',
    ROBLOX_IP_RANGES: 'roblox_ip_ranges',
    REJECTED_IPS: 'rejected_ips',
    PUBLIC_GAMES_SET: 'public_games',
    MODERATED_GAMES_SET: 'moderated_games',
    GAMES_BY_TIMESTAMP_ZSET: 'games_by_timestamp'
};

// --- Discord ---
const DISCORD_CONSTANTS = {
    APPROVE_BUTTON_CUSTOM_ID: 'approve_game',
    PRIVATIZE_BUTTON_CUSTOM_ID: 'privatize_game',
    GAMES_COMMAND_NAME: 'games'
};

// --- Channel IDs ---
const MODERATION_CHANNEL_ID = process.env.MODERATION_CHANNEL_ID;

// --- Thread IDs ---
const THREAD_IDS = {
    VERY_LOW: process.env.THREAD_ID_VERY_LOW,
    LOW: process.env.THREAD_ID_LOW,
    MEDIUM: process.env.THREAD_ID_MEDIUM,
    HIGH: process.env.THREAD_ID_HIGH,
    ENVIOUS: process.env.THREAD_ID_ENVIOUS
};

// --- Secrets ---
const SECRET_HEADER_KEY = process.env.SECRET_HEADER_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;

module.exports = {
    MAX_DESCRIPTION_LENGTH,
    FALLBACK_ROBLOX_IP_RANGES,
    AUTH_CACHE_EXPIRATION_SECONDS,
    MODERATION_THRESHOLD,
    COOLDOWN_SECONDS,
    ROBLOX_API_ENDPOINT,
    ROPROXY_API_ENDPOINT,
    THUMBNAILS_API_ENDPOINT,
    GAMEJOIN_API_ENDPOINT,
    BGPVIEW_URL,
    AWS_IP_RANGES_URL,
    USER_AGENT_AGENT_E,
    USER_AGENT_ROBLOX_LINUX,
    REDIS_KEYS,
    DISCORD_CONSTANTS,
    MODERATION_CHANNEL_ID,
    THREAD_IDS,
    SECRET_HEADER_KEY,
    CRON_SECRET,
    DISCORD_PUBLIC_KEY,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
};
