const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./config');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getWhitelistRank(robloxUsername) {
  console.log('Searching for username (case-sensitive):', robloxUsername);
  
  const { data, error } = await supabase
    .from('whitelists')
    .select('rank, roblox_username')
    .contains('roblox_username', [robloxUsername])  // This is the correct way for JSON arrays
    .single();

  console.log('Query result:', { data, error });

  if (error) {
    if (error.code === 'PGRST116') {
      console.log('No matching record found for:', robloxUsername);
      return null;
    }
    throw new Error(`Error fetching whitelist rank: ${JSON.stringify(error, null, 2)}`);
  }

  console.log('Found rank:', data?.rank);
  return data?.rank;
}

module.exports = {
    getWhitelistRank
};