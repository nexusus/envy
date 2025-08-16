const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./config');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getWhitelistRank(robloxUsername) {
  console.log(robloxUsername)
  const { data, error } = await supabase
    .from('whitelists')
    .select('rank')
    .eq('roblox_username', robloxUsername)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Error fetching whitelist rank: ${JSON.stringify(error, null, 2)}`);
  }

  return data;
}

module.exports = {
    getWhitelistRank
};
