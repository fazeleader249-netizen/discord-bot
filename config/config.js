require('dotenv').config()

module.exports = {
    token: process.env.DISCORD_TOKEN,
    clientID: process.env.CLIENT_ID,
    guildId: null,
    logChannelID: process.env.LOG_CHANNEL_ID
}