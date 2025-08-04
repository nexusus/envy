const { cleanupStaleGames } = require('./lib/core-logic.js');

module.exports = async (request, response) => {

    if (request.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
        return response.status(401).send('Unauthorized');
    }

    console.log("Scheduled job (run-cleanup) triggered via external cron.");
    try {
        await cleanupStaleGames();
        return response.status(200).send('Cleanup job executed successfully.');
    } catch (error) {
        console.error('Scheduled cleanup failed:', error);
        return response.status(500).send('Cleanup job failed.');
    }
};