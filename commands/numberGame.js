const {
    SlashCommandBuilder,
    ActionRowBuilder,
    UserSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    PermissionsBitField
} = require('discord.js');

// Lưu trữ game state cho mỗi guild
const gameStates = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('game')
        .setDescription('Quản lý trò chơi đoán số trung bình')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Thêm người chơi vào game')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Xóa người chơi khỏi game')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Xóa tất cả người chơi')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('sethost')
                .setDescription('Đặt chủ trò chơi')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Xem danh sách người chơi hiện tại')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('start')
                .setDescription('Bắt đầu trò chơi')
        )
        // ✅ NEW: abort
        .addSubcommand(subcommand =>
            subcommand
                .setName('abort')
                .setDescription('Hủy ván game đang diễn ra và reset trạng thái')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('submit')
                .setDescription('Gửi số của bạn (50-100)')
                .addIntegerOption(option =>
                    option.setName('number')
                        .setDescription('Số bạn chọn (50-100)')
                        .setRequired(true)
                        .setMinValue(50)
                        .setMaxValue(100)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('hostsubmit')
                .setDescription('Chủ trò chơi gửi phần trăm (75-125)')
                .addIntegerOption(option =>
                    option.setName('percentage')
                        .setDescription('Phần trăm (75-125)')
                        .setRequired(true)
                        .setMinValue(75)
                        .setMaxValue(125)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        // Khởi tạo game state nếu chưa có
        if (!gameStates.has(guildId)) {
            gameStates.set(guildId, {
                players: new Map(), // userId -> {nickname, number}
                host: null,
                isStarted: false,
                hostPercentage: null
            });
        }

        const gameState = gameStates.get(guildId);

        switch (subcommand) {
            case 'add':
                await handleAdd(interaction, gameState);
                break;
            case 'remove':
                await handleRemove(interaction, gameState);
                break;
            case 'clear':
                await handleClear(interaction, gameState);
                break;
            case 'sethost':
                await handleSetHost(interaction, gameState);
                break;
            case 'list':
                await handleList(interaction, gameState);
                break;
            case 'start':
                await handleStart(interaction, gameState);
                break;
            case 'abort':
                await handleAbort(interaction, gameState);
                break;
            case 'submit':
                await handleSubmit(interaction, gameState);
                break;
            case 'hostsubmit':
                await handleHostSubmit(interaction, gameState);
                break;
        }
    }
};

async function handleAdd(interaction, gameState) {
    if (gameState.isStarted) {
        return await interaction.reply({ content: '❌ Game đang diễn ra, không thể thêm người chơi!', ephemeral: true });
    }

    // Lấy tất cả thành viên trong server
    await interaction.deferReply({ ephemeral: true });
    const members = await interaction.guild.members.fetch();

    // Lọc bỏ bot và tạo danh sách
    const humanMembers = members.filter(member => !member.user.bot);
    const memberArray = Array.from(humanMembers.values());

    if (memberArray.length === 0) {
        return await interaction.editReply({ content: '❌ Không tìm thấy thành viên nào!' });
    }

    // Phân trang - mỗi trang 20 buttons (4 rows x 5 buttons)
    const itemsPerPage = 20;
    const totalPages = Math.ceil(memberArray.length / itemsPerPage);
    let currentPage = 0;

    const createPageComponents = (page) => {
        const rows = [];
        const start = page * itemsPerPage;
        const end = Math.min(start + itemsPerPage, memberArray.length);
        const pageMembers = memberArray.slice(start, end);

        // Tạo buttons cho thành viên (tối đa 4 rows x 5 buttons = 20)
        for (let i = 0; i < pageMembers.length; i += 5) {
            const row = new ActionRowBuilder();
            const slice = pageMembers.slice(i, Math.min(i + 5, pageMembers.length));

            for (const member of slice) {
                const isInGame = gameState.players.has(member.id);
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`toggle_${member.id}`)
                        .setLabel(member.displayName.substring(0, 80))
                        .setStyle(isInGame ? ButtonStyle.Success : ButtonStyle.Secondary)
                        .setEmoji(isInGame ? '✅' : '➕')
                );
            }
            rows.push(row);
        }

        // Row điều hướng và hoàn tất
        const navRow = new ActionRowBuilder();

        if (totalPages > 1) {
            navRow.addComponents(
                new ButtonBuilder()
                    .setCustomId('prev_page')
                    .setLabel('◀️ Trước')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page === 0),
                new ButtonBuilder()
                    .setCustomId('page_info')
                    .setLabel(`Trang ${page + 1}/${totalPages}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('next_page')
                    .setLabel('Sau ▶️')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page === totalPages - 1)
            );
        }

        navRow.addComponents(
            new ButtonBuilder()
                .setCustomId('done_selecting')
                .setLabel('✅ Xong')
                .setStyle(ButtonStyle.Success)
        );

        rows.push(navRow);
        return rows;
    };

    const createEmbed = (page) => {
        return new EmbedBuilder()
            .setTitle('👥 Danh sách thành viên trong server')
            .setDescription(`Chọn người chơi (Trang ${page + 1}/${totalPages})\n` +
                `**Đã chọn:** ${gameState.players.size} người\n\n` +
                `✅ = Đã trong game (click để bỏ)\n` +
                `➕ = Chưa chọn (click để thêm)`)
            .setColor('#00ff00')
            .setFooter({ text: `Tổng ${memberArray.length} thành viên` });
    };

    const message = await interaction.editReply({
        embeds: [createEmbed(currentPage)],
        components: createPageComponents(currentPage)
    });

    // Collector để xử lý button clicks
    const collector = message.createMessageComponentCollector({
        time: 300000 // 5 phút
    });

    collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
            return await i.reply({ content: '❌ Chỉ người dùng lệnh mới được chọn!', ephemeral: true });
        }

        if (i.customId === 'done_selecting') {
            collector.stop('done');
            return await i.update({
                content: `✅ Hoàn tất! Tổng số người chơi: ${gameState.players.size}`,
                embeds: [],
                components: []
            });
        }

        if (i.customId === 'prev_page') {
            currentPage = Math.max(0, currentPage - 1);
            return await i.update({
                embeds: [createEmbed(currentPage)],
                components: createPageComponents(currentPage)
            });
        }

        if (i.customId === 'next_page') {
            currentPage = Math.min(totalPages - 1, currentPage + 1);
            return await i.update({
                embeds: [createEmbed(currentPage)],
                components: createPageComponents(currentPage)
            });
        }

        // Toggle player
        if (i.customId.startsWith('toggle_')) {
            const userId = i.customId.replace('toggle_', '');
            const member = await interaction.guild.members.fetch(userId);

            if (gameState.players.has(userId)) {
                gameState.players.delete(userId);
                if (gameState.host === userId) {
                    gameState.host = null;
                }
            } else {
                gameState.players.set(userId, {
                    nickname: member.displayName,
                    number: null
                });
            }

            // Cập nhật UI
            await i.update({
                embeds: [createEmbed(currentPage)],
                components: createPageComponents(currentPage)
            });
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            interaction.editReply({
                content: `⏱️ Hết thời gian! Tổng số người chơi: ${gameState.players.size}`,
                embeds: [],
                components: []
            });
        }
    });
}

async function handleRemove(interaction, gameState) {
    if (gameState.isStarted) {
        return await interaction.reply({ content: '❌ Game đang diễn ra, không thể xóa người chơi!', ephemeral: true });
    }

    if (gameState.players.size === 0) {
        return await interaction.reply({ content: '❌ Không có người chơi nào!', ephemeral: true });
    }

    const selectMenu = new UserSelectMenuBuilder()
        .setCustomId('remove_players')
        .setPlaceholder('Chọn người chơi cần xóa')
        .setMinValues(1)
        .setMaxValues(Math.min(gameState.players.size, 10));

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
        content: '👥 Chọn người chơi muốn xóa:',
        components: [row],
        ephemeral: true
    });

    const filter = (i) => i.customId === 'remove_players' && i.user.id === interaction.user.id;

    try {
        const collected = await interaction.channel.awaitMessageComponent({
            filter,
            time: 30000
        });

        const selectedUsers = collected.values;
        let removedCount = 0;

        for (const userId of selectedUsers) {
            if (gameState.players.has(userId)) {
                gameState.players.delete(userId);
                if (gameState.host === userId) {
                    gameState.host = null;
                }
                removedCount++;
            }
        }

        await collected.update({
            content: `✅ Đã xóa ${removedCount} người chơi! Còn lại: ${gameState.players.size} người`,
            components: []
        });
    } catch (error) {
        await interaction.editReply({ content: '⏱️ Hết thời gian!', components: [] });
    }
}

async function handleClear(interaction, gameState) {
    if (gameState.isStarted) {
        return await interaction.reply({ content: '❌ Game đang diễn ra, không thể xóa!', ephemeral: true });
    }

    const playerCount = gameState.players.size;
    gameState.players.clear();
    gameState.host = null;

    await interaction.reply(`🗑️ Đã xóa ${playerCount} người chơi và reset chủ trò chơi!`);
}

async function handleSetHost(interaction, gameState) {
    if (gameState.isStarted) {
        return await interaction.reply({ content: '❌ Game đang diễn ra, không thể đổi host!', ephemeral: true });
    }

    const selectMenu = new UserSelectMenuBuilder()
        .setCustomId('select_host')
        .setPlaceholder('Chọn chủ trò chơi')
        .setMinValues(1)
        .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
        content: '👑 Chọn chủ trò chơi:',
        components: [row],
        ephemeral: true
    });

    const filter = (i) => i.customId === 'select_host' && i.user.id === interaction.user.id;

    try {
        const collected = await interaction.channel.awaitMessageComponent({
            filter,
            time: 30000
        });

        const hostId = collected.values[0];
        const member = await interaction.guild.members.fetch(hostId);

        gameState.host = hostId;

        await collected.update({
            content: `👑 Đã đặt **${member.displayName}** làm chủ trò chơi!`,
            components: []
        });
    } catch (error) {
        await interaction.editReply({ content: '⏱️ Hết thời gian!', components: [] });
    }
}

async function handleList(interaction, gameState) {
    if (gameState.players.size === 0) {
        return await interaction.reply({ content: '❌ Chưa có người chơi nào!', ephemeral: true });
    }

    const embed = new EmbedBuilder()
        .setTitle('📋 Danh sách người chơi')
        .setColor('#00ff00')
        .setTimestamp();

    const lines = [];

    for (const [userId, data] of gameState.players.entries()) {
        const isHost = userId === gameState.host;

        if (!gameState.isStarted) {
            lines.push(`${isHost ? '👑 ' : ''}**${data.nickname}**`);
            continue;
        }

        if (isHost) {
            const hostStatus = gameState.hostPercentage != null ? '✅' : '⏳';
            lines.push(`👑 ${hostStatus} **${data.nickname}**`);
        } else {
            const status = data.number != null ? '✅' : '⏳';
            lines.push(`${status} **${data.nickname}**`);
        }
    }

    embed.setDescription(lines.join('\n'));

    if (gameState.isStarted) {
        const submittedCount = Array.from(gameState.players.entries())
            .filter(([id]) => id !== gameState.host)
            .filter(([_, d]) => d.number != null).length;

        const totalPlayers = gameState.players.size - (gameState.host ? 1 : 0);

        embed.setFooter({
            text: `Đã nộp: ${submittedCount}/${totalPlayers} | Host %: ${gameState.hostPercentage != null ? '✓' : '✗'}`
        });
    } else {
        embed.setFooter({ text: `Tổng: ${gameState.players.size} người | Host: ${gameState.host ? '✓' : '✗'}` });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleStart(interaction, gameState) {
    if (gameState.isStarted) {
        return await interaction.reply({ content: '❌ Game đã bắt đầu rồi!', ephemeral: true });
    }

    if (gameState.players.size < 2) {
        return await interaction.reply({ content: '❌ Cần ít nhất 2 người chơi!', ephemeral: true });
    }

    if (!gameState.host) {
        return await interaction.reply({ content: '❌ Chưa có chủ trò chơi! Dùng `/game sethost`', ephemeral: true });
    }

    // Reset số của tất cả người chơi
    for (const [_, data] of gameState.players.entries()) {
        data.number = null;
    }
    gameState.hostPercentage = null;
    gameState.isStarted = true;

    const embed = new EmbedBuilder()
        .setTitle('🎮 GAME BẮT ĐẦU!')
        .setDescription('**Quy tắc:**\n' +
            '• Mỗi người chơi chọn một số từ **50-100**\n' +
            '• Chủ trò chơi chọn phần trăm từ **75-125**\n' +
            '• Người có số gần kết quả nhất sẽ thắng!\n\n' +
            '**Cách chơi:**\n' +
            '• Người chơi: `/game submit <số>`\n' +
            '• Chủ trò chơi: `/game hostsubmit <phần trăm>`\n' +
            '• Hủy ván: `/game abort`\n\n' +
            '**Lưu ý:** Mỗi người chơi chỉ được chọn **1 lần** trong mỗi ván.')
        .setColor('#ff9900')
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    // Tag từng người chơi (trừ host)
    for (const [userId, _] of gameState.players.entries()) {
        if (userId !== gameState.host) {
            await interaction.followUp({
                content: `<@${userId}> Đến lượt bạn! Dùng lệnh \`/game submit\` để chọn số từ 50-100 (chỉ 1 lần)`,
                allowedMentions: { users: [userId] }
            });
        }
    }
}

async function handleSubmit(interaction, gameState) {
    if (!gameState.isStarted) {
        return await interaction.reply({ content: '❌ Game chưa bắt đầu!', ephemeral: true });
    }

    const userId = interaction.user.id;

    if (!gameState.players.has(userId)) {
        return await interaction.reply({ content: '❌ Bạn không trong danh sách người chơi!', ephemeral: true });
    }

    if (userId === gameState.host) {
        return await interaction.reply({ content: '❌ Bạn là chủ trò chơi! Dùng `/game hostsubmit`', ephemeral: true });
    }

    const player = gameState.players.get(userId);

    // ✅ Chỉ cho submit 1 lần
    if (player.number != null) {
        return await interaction.reply({
            content: '❌ Bạn đã chọn số rồi! Mỗi ván chỉ được chọn **1 lần**.',
            ephemeral: true
        });
    }

    const number = interaction.options.getInteger('number');
    player.number = number;

    // Không lộ số ra ngoài
    await interaction.reply({ content: `✅ Đã ghi nhận lựa chọn của bạn.`, ephemeral: true });

    // ✅ Tự động ping host khi có người chơi submit
    if (gameState.host) {
        const submittedCount = Array.from(gameState.players.entries())
            .filter(([id]) => id !== gameState.host)
            .filter(([_, d]) => d.number != null).length;

        const totalPlayers = gameState.players.size - 1;

        await interaction.channel.send({
            content: `📩 <@${gameState.host}> **${player.nickname}** đã nộp số. Tiến độ: **${submittedCount}/${totalPlayers}**`,
            allowedMentions: { users: [gameState.host] }
        });
    }

    // Kiểm tra xem tất cả người chơi đã submit chưa
    const allSubmitted = Array.from(gameState.players.entries())
        .filter(([id]) => id !== gameState.host)
        .every(([_, data]) => data.number !== null);

    if (allSubmitted) {
        await interaction.followUp({
            content: `<@${gameState.host}> Tất cả người chơi đã chọn số! Đến lượt bạn dùng \`/game hostsubmit\` để chọn phần trăm (75-125)!`,
            allowedMentions: { users: [gameState.host] }
        });
    }
}

async function handleHostSubmit(interaction, gameState) {
    if (!gameState.isStarted) {
        return await interaction.reply({ content: '❌ Game chưa bắt đầu!', ephemeral: true });
    }

    const userId = interaction.user.id;

    if (userId !== gameState.host) {
        return await interaction.reply({ content: '❌ Chỉ chủ trò chơi mới được dùng lệnh này!', ephemeral: true });
    }

    // Kiểm tra tất cả người chơi đã submit
    const allSubmitted = Array.from(gameState.players.entries())
        .filter(([id]) => id !== gameState.host)
        .every(([_, data]) => data.number !== null);

    if (!allSubmitted) {
        return await interaction.reply({ content: '❌ Chưa đủ người chơi gửi số!', ephemeral: true });
    }

    const percentage = interaction.options.getInteger('percentage');
    gameState.hostPercentage = percentage;

    await interaction.reply({ content: `✅ Đã lưu phần trăm: **${percentage}%**`, ephemeral: true });

    // Tính toán kết quả
    await calculateAndAnnounceWinner(interaction, gameState);
}

// ✅ Abort game
async function handleAbort(interaction, gameState) {
    if (!gameState.isStarted) {
        return await interaction.reply({ content: '❌ Hiện không có ván game nào đang diễn ra!', ephemeral: true });
    }

    const userId = interaction.user.id;
    const isHost = userId === gameState.host;

    // Cho phép abort nếu là host hoặc có quyền quản lý server
    const member = interaction.member; // GuildMember
    const hasPower =
        member?.permissions?.has(PermissionsBitField.Flags.Administrator) ||
        member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);

    if (!isHost && !hasPower) {
        return await interaction.reply({
            content: '❌ Chỉ **Host** hoặc người có quyền **Manage Server / Administrator** mới được hủy game!',
            ephemeral: true
        });
    }

    const hostId = gameState.host;
    const totalPlayers = gameState.players.size;

    // Reset trạng thái ván chơi (giữ danh sách player & host)
    gameState.isStarted = false;
    gameState.hostPercentage = null;

    for (const [_, data] of gameState.players.entries()) {
        data.number = null;
    }

    await interaction.reply({
        content:
            `🛑 **Ván game đã bị hủy** bởi <@${userId}>.\n` +
            `• Host: ${hostId ? `<@${hostId}>` : 'Chưa đặt'}\n` +
            `• Người chơi trong danh sách: **${totalPlayers}**\n` +
            `Trạng thái đã được reset. Có thể dùng \`/game start\` để bắt đầu lại.`,
        allowedMentions: { users: hostId ? [userId, hostId] : [userId] }
    });
}

async function calculateAndAnnounceWinner(interaction, gameState) {
    // Lấy tất cả số của người chơi (trừ host)
    const playerNumbers = Array.from(gameState.players.entries())
        .filter(([id]) => id !== gameState.host)
        .map(([_, data]) => data.number);

    // Tính trung bình
    const average = playerNumbers.reduce((sum, num) => sum + num, 0) / playerNumbers.length;

    // Tính kết quả
    const result = average * (gameState.hostPercentage / 100);

    // Tìm người thắng (gần result nhất)
    let winner = null;
    let minDiff = Infinity;

    const playerResults = [];

    for (const [userId, data] of gameState.players.entries()) {
        if (userId === gameState.host) continue;

        const diff = Math.abs(data.number - result);
        playerResults.push({
            userId,
            nickname: data.nickname,
            number: data.number,
            diff
        });

        if (diff < minDiff) {
            minDiff = diff;
            winner = { userId, nickname: data.nickname, number: data.number };
        }
    }

    // Sắp xếp theo độ gần
    playerResults.sort((a, b) => a.diff - b.diff);

    // Tạo embed kết quả
    const embed = new EmbedBuilder()
        .setTitle('🏆 KẾT QUẢ TRÒ CHƠI')
        .setColor('#ffcc00')
        .setTimestamp();

    let description = `**Số trung bình:** ${average.toFixed(2)}\n`;
    description += `**Phần trăm (Host):** ${gameState.hostPercentage}%\n`;
    description += `**KẾT QUẢ:** ${result.toFixed(2)}\n\n`;
    description += `**🥇 NGƯỜI THẮNG: ${winner.nickname}** (Chọn: ${winner.number})\n\n`;
    description += `**📊 Bảng xếp hạng:**\n`;

    for (let i = 0; i < playerResults.length; i++) {
        const p = playerResults[i];
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '▫️';
        description += `${medal} **${p.nickname}** - Chọn: ${p.number} | Chênh lệch: ${p.diff.toFixed(2)}\n`;
    }

    embed.setDescription(description);

    await interaction.followUp({ embeds: [embed] });

    // Reset game
    gameState.isStarted = false;
    gameState.hostPercentage = null;
    for (const [_, data] of gameState.players.entries()) {
        data.number = null;
    }
}
