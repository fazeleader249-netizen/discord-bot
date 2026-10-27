const { SlashCommandBuilder } = require('discord.js');
const { handlePraiseRoast } = require('../utils/praiseRoast');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('khen')
        .setDescription('Nhờ AI khen ai đó lên tận mây xanh 🌸')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Người được khen')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('goi_y')
                .setDescription('Gợi ý về người đó để khen trúng hơn (vd: code giỏi, hát hay)')
                .setMaxLength(100)),

    async execute(interaction) {
        await handlePraiseRoast(interaction, 'khen');
    }
};
