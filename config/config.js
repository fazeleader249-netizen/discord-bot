require('dotenv').config()

module.exports = {
    token: process.env.DISCORD_TOKEN,
    clientID: process.env.CLIENT_ID,
    guildId: null,
    logChannelID: process.env.LOG_CHANNEL_ID,
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || 'gemini-flash-lite-latest',
    geminiDailyLimit: Number(process.env.GEMINI_DAILY_LIMIT) || 200
}