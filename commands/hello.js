const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hello')
        .setDescription('Bot sẽ chào bạn! Chào kiểu hehehehe'),
    
    async execute(interaction) {
        const user = interaction.user;
        const greetings = [
            `Dân chơi ${user.displayName || user.username}! đây rồiiii`,
            `Konichiwa ${user.displayName || user.username}! 🎉`,
            `Hế lô ${user.displayName || user.username}! ✨`,
            `Chào mừng ${user.displayName || user.username}! 🌟`
        ];
        
        const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
        
        await interaction.reply({
            content: randomGreeting,
            ephemeral: false
        });
    },
};