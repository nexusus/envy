require('dotenv').config();

const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { DISCORD_CONSTANTS } = require('./lib/config');

const commands = [
    {
        name: DISCORD_CONSTANTS.GAMES_COMMAND_NAME,
        description: 'Displays live statistics about the games being tracked.',
    },
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_APP_ID),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();
