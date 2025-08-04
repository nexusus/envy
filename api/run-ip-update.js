const { updateRobloxIps } = require('./lib/core-logic.js');

module.exports = async (request, response) => {
    if (request.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
        return response.status(401).send('Unauthorized');
    }

    console.log("Scheduled job (run-ip-update) triggered via external cron.");
    try {
        await updateRobloxIps();
        return response.status(200).send('Scheduled IP update successful.');
    } catch (error) {
        console.error('Scheduled IP update failed:', error);
        return response.status(500).send('Scheduled IP update failed.');
    }
};