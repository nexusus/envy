const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./config');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getWhitelistRank(robloxUsername) {
    const { data, error } = await supabase
        .from('whitelists')
        .select('rank')
        .cs('roblox_username', [robloxUsername])
        .single();

    if (error) {
        console.error('Error fetching whitelist rank:', error);
        return null;
    }

    return data ? data.rank : null;
}

module.exports = {
    getWhitelistRank
};
