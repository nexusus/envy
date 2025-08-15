const { cleanupStaleGames, cleanupOrphanedMessages } = require('../lib/core-logic.js');
const { CRON_SECRET } = require('../lib/config.js');

module.exports = async (request, response) => {

    if (request.headers['authorization'] !== `Bearer ${CRON_SECRET}`) {
        return response.status(401).send('Unauthorized');
    }

    console.log("Scheduled job (run-cleanup) triggered via external cron.");
    try {
        // Run both cleanup tasks concurrently for efficiency
        const results = await Promise.allSettled([
            cleanupStaleGames(),
            cleanupOrphanedMessages()
        ]);

        let failed = false;
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                const taskName = index === 0 ? 'cleanupStaleGames' : 'cleanupOrphanedMessages';
                console.error(`Scheduled cleanup for ${taskName} failed:`, result.reason);
                failed = true;
            }
        });

        if (failed) {
            // Return a 500 status if any of the promises were rejected
            return response.status(500).send('One or more cleanup tasks failed.');
        }

        return response.status(200).send('All cleanup jobs executed successfully.');

    } catch (error) {
        // This will catch errors not related to the promises themselves (e.g., setup issues)
        console.error('An unexpected error occurred in the cleanup handler:', error);
        return response.status(500).send('Cleanup job handler failed.');
    }
};
