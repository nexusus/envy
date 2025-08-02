const { updateRobloxIps } = require('./Lib/update-roblox-ips');

exports.handler = async () => {
  
  console.log("Deploy succeeded. Triggering post-deploy IP list update.");
  try {
      await updateRobloxIps();
      return { statusCode: 200, body: 'Post-deploy IP update successful.' };
  } catch (error) {
      // Returning 500 here won't fail the deploy, but it will log the error.
      return { statusCode: 500, body: 'Post-deploy IP update failed.' };
  }
};
