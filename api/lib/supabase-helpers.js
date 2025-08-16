const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./config');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getWhitelistRank(robloxUsername) {
  const { data, error } = await supabase.rpc('get_user_by_roblox_username', {
    p_roblox_username: robloxUsername,
  }).single();

  if (error) {
    throw new Error(`Error fetching whitelist rank: ${JSON.stringify(error, null, 2)}`);
  }

  return data;
}

module.exports = {
    getWhitelistRank
};
