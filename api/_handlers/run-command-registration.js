const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

const commands = [];

module.exports = async (request, response) => {
    // Security check: Only run if a secret is provided in the query string
    if (request.query.secret !== process.env.CRON_SECRET) {
        return response.status(401).send('Unauthorized');
    }

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_APP_ID),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
        return response.status(200).send('Commands registered successfully!');
    } catch (error) {
        console.error(error);
        return response.status(500).send('Failed to register commands.');
    }
};
