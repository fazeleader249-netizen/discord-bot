const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Hiển thị danh sách lệnh và mô tả'),

    async execute(interaction) {
        const commands = interaction.client.commands;

        const embed = new EmbedBuilder()
            .setTitle('📖 Danh sách lệnh')
            .setColor(0x00AE86)
            .setDescription('Dưới đây là các lệnh mà bạn có thể sử dụng:');

        for (const [name, command] of commands) {
            embed.addFields({
                name: `/${name}`,
                value: command.data.description || 'Không có mô tả',
                inline: false
            });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
