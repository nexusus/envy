const { updateRobloxIps } = require('./Lib/update-roblox-ips');

exports.handler = async () => {
    console.log("Force update triggered. Calling shared logic now...");
    try {
        await updateRobloxIps();
        const successMessage = "SUCCESS: The IP update logic ran without errors.";
        console.log(successMessage);
        return { 
            statusCode: 200, 
            body: successMessage 
        };
    } catch (error) {
        const errorMessage = `FAILURE: The IP update logic failed. Check the function logs for details. Error: ${error}`;
        console.error(errorMessage);
        return { 
            statusCode: 500, 
            body: errorMessage
        };
    }
};
