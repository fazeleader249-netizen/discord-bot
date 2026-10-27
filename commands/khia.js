const { SlashCommandBuilder } = require('discord.js');
const { handlePraiseRoast } = require('../utils/praiseRoast');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('khia')
        .setDescription('Nhờ AI cà khịa ai đó (vui thôi đừng giận) 🔥')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Người bị cà khịa')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('goi_y')
                .setDescription('Gợi ý để khịa trúng hơn (vd: hay đi họp muộn, toàn bật nhạc dở)')
                .setMaxLength(100)),

    async execute(interaction) {
        await handlePraiseRoast(interaction, 'khia');
    }
};
