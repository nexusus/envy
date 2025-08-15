const indexHandler = require('./_handlers/index');
const interactionsHandler = require('./_handlers/interactions');
const linkHandler = require('./_handlers/link');
const cleanupHandler = require('./_handlers/run-cleanup');
const ipUpdateHandler = require('./_handlers/run-ip-update');
const commandRegistrationHandler = require('./_handlers/run-command-registration');
const debugHandler = require('./_handlers/debug');

module.exports = async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const path = url.pathname;

    // This simple router delegates requests based on the path.
    if (path === '/' || path.startsWith('/api/index')) {
        return indexHandler(request, response);
    } else if (path.startsWith('/api/interactions')) {
        return interactionsHandler(request, response);
    } else if (path.startsWith('/api/link')) {
        return linkHandler(request, response);
    } else if (path.startsWith('/api/run-cleanup')) {
        return cleanupHandler(request, response);
    } else if (path.startsWith('/api/run-ip-update')) {
        return ipUpdateHandler(request, response);
    } else if (path.startsWith('/api/run-command-registration')) {
        return commandRegistrationHandler(request, response);
    } else if (path.startsWith('/api/debug')) {
        return debugHandler(request, response);
    } else {
        // Fallback to the index handler for any other requests.
        return indexHandler(request, response);
    }
};
