const { updateRobloxIps } = require('./Lib/update-roblox-ips');

exports.handler = async () => {
    console.log("Running scheduled job: IP list update.");
    try {
        await updateRobloxIps();
        return { statusCode: 200, body: 'Scheduled IP update successful.' };
    } catch (error) {
        return { statusCode: 500, body: 'Scheduled IP update failed.' };
    }
};
