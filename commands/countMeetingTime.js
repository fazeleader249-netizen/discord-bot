const { SlashCommandBuilder } = require('discord.js');
const { ExcelJS } = require('exceljs');
const path = require('path');
const fs = require('fs');

// Store active tracking sessions
const activeSessions = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('meetingtime')
        .setDescription('Theo dõi thời gian tham gia voice channel')
        .addStringOption(option =>
            option.setName('channel')
                .setDescription('Tên kênh voice')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Hành động: start hoặc end')
                .setRequired(true)
                .addChoices(
                    { name: 'start', value: 'start' },
                    { name: 'end', value: 'end' }
                )),

    async execute(interaction) {
        const channelName = interaction.options.getString('channel');
        const action = interaction.options.getString('action');

        try {
            // Tìm voice channel theo tên
            const voiceChannel = interaction.guild.channels.cache.find(
                ch => ch.name === channelName && ch.isVoiceBased()
            );

            if (!voiceChannel) {
                return await interaction.reply({
                    content: `❌ Không tìm thấy kênh voice có tên "${channelName}"`,
                    ephemeral: true
                });
            }

            const sessionKey = `${interaction.guild.id}-${voiceChannel.id}`;

            if (action === 'start') {
                // Kiểm tra xem đã có session active chưa
                if (activeSessions.has(sessionKey)) {
                    return await interaction.reply({
                        content: `⚠️ Đã có phiên tracking đang chạy cho kênh "${channelName}". Vui lòng kết thúc phiên cũ trước.`,
                        ephemeral: true
                    });
                }

                // Lấy danh sách members hiện tại trong voice channel
                const members = voiceChannel.members;
                
                if (members.size === 0) {
                    return await interaction.reply({
                        content: `⚠️ Không có ai trong kênh voice "${channelName}"`,
                        ephemeral: true
                    });
                }

                const startTime = Date.now();
                const memberData = new Map();

                members.forEach(member => {
                    memberData.set(member.id, {
                        username: member.user.tag,
                        displayName: member.displayName,
                        joinTime: startTime,
                        totalTime: 0,
                        isCurrentlyInChannel: true
                    });
                });

                // Lưu session
                activeSessions.set(sessionKey, {
                    channelId: voiceChannel.id,
                    channelName: voiceChannel.name,
                    startTime: startTime,
                    memberData: memberData,
                    startedBy: interaction.user.tag
                });

                // Setup voice state update listener
                setupVoiceStateListener(interaction.client, sessionKey);

                await interaction.reply({
                    content: `✅ Bắt đầu tracking thời gian cho kênh **${channelName}**\n` +
                             `👥 Đang tracking ${members.size} thành viên\n` +
                             `🕐 Thời gian bắt đầu: ${formatTime(new Date(startTime))}`,
                    ephemeral: false
                });

            } else if (action === 'end') {
                const session = activeSessions.get(sessionKey);

                if (!session) {
                    return await interaction.reply({
                        content: `❌ Không có phiên tracking nào đang chạy cho kênh "${channelName}"`,
                        ephemeral: true
                    });
                }

                await interaction.deferReply();

                // Tính toán thời gian cuối cùng
                const endTime = Date.now();
                session.memberData.forEach((data, memberId) => {
                    if (data.isCurrentlyInChannel) {
                        data.totalTime += endTime - data.joinTime;
                    }
                });

                // Tạo file Excel
                const filePath = await generateExcelReport(session, endTime);

                // Gửi file
                await interaction.editReply({
                    content: `✅ Kết thúc tracking cho kênh **${channelName}**\n` +
                             `🕐 Thời gian kết thúc: ${formatTime(new Date(endTime))}\n` +
                             `⏱️ Tổng thời gian: ${formatDuration(endTime - session.startTime)}`,
                    files: [filePath]
                });

                // Xóa file sau khi gửi
                setTimeout(() => {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                }, 5000);

                // Xóa session
                activeSessions.delete(sessionKey);
            }

        } catch (error) {
            console.error('Error in meetingtime command:', error);
            
            if (interaction.deferred) {
                await interaction.editReply({
                    content: '❌ Đã xảy ra lỗi khi xử lý lệnh. Vui lòng thử lại.',
                });
            } else {
                await interaction.reply({
                    content: '❌ Đã xảy ra lỗi khi xử lý lệnh. Vui lòng thử lại.',
                    ephemeral: true
                });
            }
        }
    },
};

function setupVoiceStateListener(client, sessionKey) {
    const session = activeSessions.get(sessionKey);
    if (!session) return;

    const listener = (oldState, newState) => {
        const currentSession = activeSessions.get(sessionKey);
        if (!currentSession) {
            client.off('voiceStateUpdate', listener);
            return;
        }

        const member = newState.member;
        const now = Date.now();

        // Member joined the tracked channel
        if (newState.channelId === currentSession.channelId && oldState.channelId !== currentSession.channelId) {
            if (!currentSession.memberData.has(member.id)) {
                currentSession.memberData.set(member.id, {
                    username: member.user.tag,
                    displayName: member.displayName,
                    joinTime: now,
                    totalTime: 0,
                    isCurrentlyInChannel: true
                });
            } else {
                const data = currentSession.memberData.get(member.id);
                data.joinTime = now;
                data.isCurrentlyInChannel = true;
            }
        }

        // Member left the tracked channel
        if (oldState.channelId === currentSession.channelId && newState.channelId !== currentSession.channelId) {
            const data = currentSession.memberData.get(member.id);
            if (data && data.isCurrentlyInChannel) {
                data.totalTime += now - data.joinTime;
                data.isCurrentlyInChannel = false;
            }
        }
    };

    client.on('voiceStateUpdate', listener);
}

async function generateExcelReport(session, endTime) {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Meeting Time Report');

    // Thiết lập headers
    worksheet.columns = [
        { header: 'Người tham gia', key: 'name', width: 30 },
        { header: 'Thời gian', key: 'duration', width: 15 }
    ];

    // Style cho header
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Thêm dữ liệu
    const sortedMembers = Array.from(session.memberData.values())
        .sort((a, b) => b.totalTime - a.totalTime);

    sortedMembers.forEach(member => {
        worksheet.addRow({
            name: member.displayName || member.username,
            duration: formatDuration(member.totalTime)
        });
    });

    // Tự động điều chỉnh độ rộng cột
    worksheet.columns.forEach(column => {
        column.alignment = { vertical: 'middle', horizontal: 'left' };
    });

    // Tạo thư mục temp nếu chưa có
    const tempDir = path.join(__dirname, '..', 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    const currentTime = getEnglishTimestamp()
    // Lưu file
    const fileName = `meeting_${session.channelName}_${currentTime}.xlsx`;
    const filePath = path.join(tempDir, fileName);
    await workbook.xlsx.writeFile(filePath);

    return filePath;
}

function formatDuration(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m${seconds}s`;
}

function formatTime(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}
function getEnglishTimestamp() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0'); 
  const year = now.getFullYear();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');

  // Ghép chuỗi theo định dạng "ngày_tháng_năm_giờ_phút"
  const timestamp = `${day}_${month}_${year}_${hours}h_${minutes}m`;

  return timestamp;
}