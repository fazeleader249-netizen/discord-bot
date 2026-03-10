const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Kiểm tra độ trễ của bot'),
    
    async execute(interaction) {
        const sent = await interaction.reply({
            content: 'Pinging...',
            fetchReply: true
        });
        
        const ping = sent.createdTimestamp - interaction.createdTimestamp;
        
        await interaction.editReply({
            content: `🏓 Pong!\n⏱️ Độ trễ: ${ping}ms\n💓 API Latency: ${Math.round(interaction.client.ws.ping)}ms`
        });
    },
};