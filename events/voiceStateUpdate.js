const {Events} = require('discord.js')
const path = require('path')
const { EventEmitter } = require('stream')
const axios = require('axios');
const fs = require('fs');

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    entersState,
    VoiceConnectionStatus,
    getVoiceConnection
} = require('@discordjs/voice');

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        const member = newState.member;

        // Bỏ qua bot
        if (!member || member.user.bot) return;

        // ID bot chào nếu có
        const botId = 1391897786210979911;
        if (botId === member.id) return;

        // Khi ai đó vào voice
        if (!oldState.channel && newState.channel) {
            console.log(`${member.user.tag} đã vào kênh voice: ${newState.channel.name}`);
            welcomeToChannel(member);
        }

        // Khi ai đó rời voice
        else if (oldState.channel && !newState.channel) {
            console.log(`${member.user.tag} đã rời khỏi kênh voice: ${oldState.channel.name}`);

            const channel = oldState.channel;

            // Kiểm tra xem kênh chỉ còn bot
            const nonBotMembers = channel.members.filter(m => !m.user.bot);

            // Nếu không còn ai ngoài bot → destroy connection
            if (nonBotMembers.size === 0) {
                // Lấy connection của bot trong guild này
                const connection = getVoiceConnection(channel.guild.id);
                
                if (connection) {
                    connection.destroy();
                    console.log("Bot đã tự thoát vì không còn ai trong kênh.");
                }
            }
        }
    }
};

// =========================
//  WELCOME FUNCTION
// =========================
async function welcomeToChannel(member) {
    const voiceChannel = member.voice.channel;
    const nickname = member.nickname || member.user.globalName || member.user.username;
    
    if (!voiceChannel) return;

    try {
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 5000);

        const player = createAudioPlayer();
        const gTTS = require('gtts');

        // Tạo file mp3
        const text = `Con vợ ${nickname} chào anh em nhé hẹ hẹ hẹ`;
        const gtts = new gTTS(text, 'vi');

        const soundsDir = path.join(__dirname, '../sounds');
        if (!fs.existsSync(soundsDir)) {
            fs.mkdirSync(soundsDir, { recursive: true });
        }

        const filePath = path.join(soundsDir, `hello_${member.id}_${Date.now()}.mp3`);

        gtts.save(filePath, function (err) {
            if (err) {
                console.error('Lỗi tạo file:', err);
                connection.destroy();
                return;
            }

            console.log(`Đã tạo file chào: ${filePath}`);

            const resource = createAudioResource(filePath);
            player.play(resource);
            connection.subscribe(player);

            // Bot tự out sau khi chào xong
            player.on(AudioPlayerStatus.Idle, () => {
                console.log('Đã phát xong lời chào');
                
                // setTimeout(() => {
                //     connection.destroy();
                //     console.log('Bot đã out sau khi chào xong');
                // }, 500);

                // Xóa file sau khi phát xong
                setTimeout(() => {
                    if (fs.existsSync(filePath)) {
                        try {
                            fs.unlinkSync(filePath);
                            console.log(`Đã xóa file: ${filePath}`);
                        } catch (err) {
                            console.error('Lỗi khi xóa file:', err);
                        }
                    }
                }, 2000);
            });

            // Xử lý lỗi
            player.on('error', error => {
                console.error('Lỗi audio player:', error);
                connection.destroy();
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            });
        });

    } catch (error) {
        console.error('Lỗi khi phát file chào:', error);
    }
}