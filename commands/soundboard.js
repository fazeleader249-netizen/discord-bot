const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    PermissionsBitField,
    AttachmentBuilder
} = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState
} = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');

// Thư mục lưu trữ soundboard files
const SOUNDBOARD_DIR = path.join(__dirname, 'soundboard');
const MAPPING_FILE = path.join(SOUNDBOARD_DIR, 'mapping.json');

// Đảm bảo thư mục tồn tại
if (!fs.existsSync(SOUNDBOARD_DIR)) {
    fs.mkdirSync(SOUNDBOARD_DIR, { recursive: true });
}

// Khởi tạo file mapping nếu chưa có
if (!fs.existsSync(MAPPING_FILE)) {
    fs.writeFileSync(MAPPING_FILE, JSON.stringify({}, null, 2));
}

// Hàm đọc mapping
function loadMapping() {
    try {
        const data = fs.readFileSync(MAPPING_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

// Hàm lưu mapping
function saveMapping(mapping) {
    fs.writeFileSync(MAPPING_FILE, JSON.stringify(mapping, null, 2));
}

// Âm lượng mặc định và giới hạn (%)
const DEFAULT_VOLUME = 100;
const MIN_VOLUME = 1;
const MAX_VOLUME = 200;

// Chuẩn hóa entry trong mapping (hỗ trợ format cũ: displayName -> fileName)
function getEntry(mapping, displayName) {
    const value = mapping[displayName];
    if (!value) return null;
    if (typeof value === 'string') {
        return { file: value, volume: DEFAULT_VOLUME };
    }
    return { file: value.file, volume: value.volume ?? DEFAULT_VOLUME };
}

// Tìm tên display (key trong mapping) không phân biệt hoa thường
function findMappingKey(mapping, displayName) {
    const lower = displayName.toLowerCase();
    return Object.keys(mapping).find(key => key.toLowerCase() === lower) || null;
}

// Tạo tên file chưa tồn tại trong thư mục (tránh ghi đè file của sound khác)
function createUniqueFileName(safeFileName, ext) {
    let fileName = `${safeFileName}${ext}`;
    let counter = 1;
    while (fs.existsSync(path.join(SOUNDBOARD_DIR, fileName))) {
        fileName = `${safeFileName}_${counter}${ext}`;
        counter++;
    }
    return fileName;
}

// Hàm tạo tên file an toàn (không dấu, không khoảng trắng)
function createSafeFileName(displayName) {
    return displayName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Bỏ dấu
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .replace(/[^a-zA-Z0-9]/g, '_') // Thay ký tự đặc biệt bằng _
        .toLowerCase()
        .substring(0, 50); // Giới hạn độ dài
}

// Queue để xử lý âm thanh tuần tự
const audioQueues = new Map(); // guildId -> {queue: [], isPlaying: boolean}

// Hàm tiện ích để tự động xóa reply sau delay
async function autoDeleteReply(reply, delay = 5000) {
    if (reply && typeof reply.delete === 'function') {
        setTimeout(() => {
            reply.delete().catch(() => {});
        }, delay);
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('soundboard')
        .setDescription('Quản lý soundboard')
        .addSubcommand(subcommand =>
            subcommand
                .setName('show')
                .setDescription('Hiển thị danh sách soundboard')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Thêm âm thanh mới vào soundboard')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Tên của âm thanh (tối đa 30 ký tự)')
                        .setRequired(true)
                        .setMaxLength(30)
                )
                .addAttachmentOption(option =>
                    option.setName('file')
                        .setDescription('File âm thanh (.mp3 hoặc .ogg)')
                        .setRequired(true)
                )
                .addIntegerOption(option =>
                    option.setName('volume')
                        .setDescription(`Âm lượng % (${MIN_VOLUME}-${MAX_VOLUME}, mặc định ${DEFAULT_VOLUME})`)
                        .setRequired(false)
                        .setMinValue(MIN_VOLUME)
                        .setMaxValue(MAX_VOLUME)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('edit')
                .setDescription('Sửa tên hoặc âm lượng của âm thanh')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Tên âm thanh cần sửa')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addStringOption(option =>
                    option.setName('new_name')
                        .setDescription('Tên mới (tối đa 30 ký tự)')
                        .setRequired(false)
                        .setMaxLength(30)
                )
                .addIntegerOption(option =>
                    option.setName('volume')
                        .setDescription(`Âm lượng % mới (${MIN_VOLUME}-${MAX_VOLUME})`)
                        .setRequired(false)
                        .setMinValue(MIN_VOLUME)
                        .setMaxValue(MAX_VOLUME)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Xóa âm thanh khỏi soundboard')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Tên âm thanh cần xóa')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Xem danh sách tất cả âm thanh')
        ),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        const sounds = getSoundList();
        const filtered = sounds.filter(sound => 
            sound.displayName.toLowerCase().includes(focusedValue.toLowerCase())
        );
        
        await interaction.respond(
            filtered.slice(0, 25).map(sound => ({ name: sound.displayName, value: sound.displayName }))
        );
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'show':
                await handleShow(interaction);
                break;
            case 'add':
                await handleAdd(interaction);
                break;
            case 'edit':
                await handleEdit(interaction);
                break;
            case 'remove':
                await handleRemove(interaction);
                break;
            case 'list':
                await handleList(interaction);
                break;
        }
    }
};

function getSoundList() {
    if (!fs.existsSync(SOUNDBOARD_DIR)) {
        return [];
    }
    
    const mapping = loadMapping();
    const sounds = [];
    
    // Duyệt qua tất cả file trong thư mục
    const files = fs.readdirSync(SOUNDBOARD_DIR)
        .filter(file => file.endsWith('.mp3') || file.endsWith('.ogg'));
    
    for (const file of files) {
        // Tìm display name từ mapping
        let displayName = null;
        let volume = DEFAULT_VOLUME;
        for (const name of Object.keys(mapping)) {
            const entry = getEntry(mapping, name);
            if (entry.file === file) {
                displayName = name;
                volume = entry.volume;
                break;
            }
        }

        // Nếu không tìm thấy trong mapping, dùng tên file (bỏ extension)
        if (!displayName) {
            displayName = file.replace(/\.(mp3|ogg)$/, '');
        }

        sounds.push({
            displayName: displayName,
            fileName: file,
            ext: path.extname(file),
            volume: volume
        });
    }
    
    return sounds;
}

async function handleShow(interaction) {
    const sounds = getSoundList();

    if (sounds.length === 0) {
        const reply = await interaction.reply({
            content: '❌ Chưa có âm thanh nào! Dùng `/soundboard add` để thêm.',
            ephemeral: true,
            fetchReply: true
        });
        autoDeleteReply(reply);
        return;
    }

    // Phân trang - mỗi trang 20 buttons (4 rows x 5 buttons)
    const itemsPerPage = 20;
    const totalPages = Math.ceil(sounds.length / itemsPerPage);
    let currentPage = 0;

    const createPageComponents = (page) => {
        const rows = [];
        const start = page * itemsPerPage;
        const end = Math.min(start + itemsPerPage, sounds.length);
        const pageSounds = sounds.slice(start, end);

        // Tạo buttons cho sounds (tối đa 4 rows x 5 buttons = 20)
        for (let i = 0; i < pageSounds.length; i += 5) {
            const row = new ActionRowBuilder();
            const slice = pageSounds.slice(i, Math.min(i + 5, pageSounds.length));

            for (const sound of slice) {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`play_${sound.displayName}`)
                        .setLabel(sound.displayName.substring(0, 80))
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🔊')
                );
            }
            rows.push(row);
        }

        // Row điều hướng nếu có nhiều trang
        if (totalPages > 1) {
            const navRow = new ActionRowBuilder();
            navRow.addComponents(
                new ButtonBuilder()
                    .setCustomId('prev_page')
                    .setLabel('◀️ Trước')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === 0),
                new ButtonBuilder()
                    .setCustomId('page_info')
                    .setLabel(`Trang ${page + 1}/${totalPages}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('next_page')
                    .setLabel('Sau ▶️')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === totalPages - 1)
            );
            rows.push(navRow);
        }

        return rows;
    };

    const createEmbed = (page) => {
        return new EmbedBuilder()
            .setTitle('🎵 Soundboard')
            .setDescription(`Chọn âm thanh để phát (Trang ${page + 1}/${totalPages})\n\n` +
                `**Lưu ý:** Bạn phải ở trong voice channel để phát âm thanh!`)
            .setColor('#00aaff')
            .setFooter({ text: `Tổng: ${sounds.length} âm thanh` })
            .setTimestamp();
    };

    const message = await interaction.reply({
        embeds: [createEmbed(currentPage)],
        components: createPageComponents(currentPage),
        fetchReply: true
    });

    // Collector để xử lý button clicks
    const collector = message.createMessageComponentCollector({
        time: 300000 // 5 phút
    });

    collector.on('collect', async (i) => {
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

        // Play sound
        if (i.customId.startsWith('play_')) {
            const displayName = i.customId.replace('play_', '');
            await playSound(i, displayName);
        }
    });

    collector.on('end', () => {
        interaction.editReply({
            components: []
        }).catch(() => {});
    });
}

async function handleAdd(interaction) {
    // Kiểm tra quyền (chỉ admin hoặc manage server)
    const member = interaction.member;
    const hasPower = member?.permissions?.has(PermissionsBitField.Flags.Administrator) ||
                     member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);

    if (!hasPower) {
        const reply = await interaction.reply({
            content: '❌ Bạn cần quyền **Administrator** hoặc **Manage Server** để thêm âm thanh!',
            ephemeral: true,
            fetchReply: true
        });
        autoDeleteReply(reply);
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    const displayName = interaction.options.getString('name').trim();
    const attachment = interaction.options.getAttachment('file');
    const volume = interaction.options.getInteger('volume') ?? DEFAULT_VOLUME;

    // Validate độ dài
    if (displayName.length === 0 || displayName.length > 30) {
        const reply = await interaction.editReply({
            content: '❌ Tên phải có từ 1-30 ký tự!'
        });
        autoDeleteReply(reply);
        return;
    }

    // Kiểm tra file có phải mp3 hoặc ogg không
    const isValidAudio = 
        (attachment.contentType && (
            attachment.contentType.includes('audio/mpeg') || 
            attachment.contentType.includes('audio/ogg') ||
            attachment.contentType.includes('audio/vorbis')
        )) ||
        attachment.name.endsWith('.mp3') ||
        attachment.name.endsWith('.ogg');

    if (!isValidAudio) {
        const reply = await interaction.editReply({
            content: '❌ Chỉ nhận file **.mp3** hoặc **.ogg**! File của bạn không đúng định dạng.'
        });
        autoDeleteReply(reply);
        return;
    }

    // Kiểm tra kích thước (giới hạn 8MB)
    if (attachment.size > 8 * 1024 * 1024) {
        const reply = await interaction.editReply({
            content: '❌ File quá lớn! Giới hạn 8MB.'
        });
        autoDeleteReply(reply);
        return;
    }

    // Kiểm tra trùng lặp tên (không phân biệt hoa thường)
    const sounds = getSoundList();
    const nameExists = sounds.some(sound => sound.displayName.toLowerCase() === displayName.toLowerCase());
    
    if (nameExists) {
        const reply = await interaction.editReply({
            content: `❌ Âm thanh **${displayName}** đã tồn tại! Dùng tên khác hoặc xóa file cũ trước.`
        });
        autoDeleteReply(reply);
        return;
    }

    try {
        // Tạo tên file an toàn
        const safeFileName = createSafeFileName(displayName);
        
        // Xác định extension từ file gốc
        const originalExt = path.extname(attachment.name);
        const ext = (originalExt === '.ogg' || originalExt === '.mp3') ? originalExt : '.mp3';
        const fileName = createUniqueFileName(safeFileName, ext);
        const filePath = path.join(SOUNDBOARD_DIR, fileName);

        // Download file
        const response = await fetch(attachment.url);
        const buffer = await response.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(buffer));

        // Lưu mapping
        const mapping = loadMapping();
        mapping[displayName] = { file: fileName, volume };
        saveMapping(mapping);

        const reply = await interaction.editReply({
            content: `✅ Đã thêm âm thanh **${displayName}** (🔉 ${volume}%) vào soundboard!`
        });
        autoDeleteReply(reply);
    } catch (error) {
        console.error('Error saving soundboard file:', error);
        const reply = await interaction.editReply({
            content: '❌ Có lỗi xảy ra khi lưu file!'
        });
        autoDeleteReply(reply);
    }
}

async function handleEdit(interaction) {
    // Kiểm tra quyền
    const member = interaction.member;
    const hasPower = member?.permissions?.has(PermissionsBitField.Flags.Administrator) ||
                     member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);

    if (!hasPower) {
        const reply = await interaction.reply({
            content: '❌ Bạn cần quyền **Administrator** hoặc **Manage Server** để sửa âm thanh!',
            ephemeral: true,
            fetchReply: true
        });
        autoDeleteReply(reply);
        return;
    }

    const displayName = interaction.options.getString('name');
    const newNameRaw = interaction.options.getString('new_name');
    const newName = newNameRaw ? newNameRaw.trim() : null;
    const newVolume = interaction.options.getInteger('volume');

    if (!newName && newVolume === null) {
        const reply = await interaction.reply({
            content: '❌ Hãy nhập ít nhất **new_name** hoặc **volume** để sửa!',
            ephemeral: true,
            fetchReply: true
        });
        autoDeleteReply(reply);
        return;
    }

    const mapping = loadMapping();
    const entry = getEntry(mapping, displayName);

    if (!entry) {
        const reply = await interaction.reply({
            content: `❌ Không tìm thấy âm thanh **${displayName}**!`,
            ephemeral: true,
            fetchReply: true
        });
        autoDeleteReply(reply);
        return;
    }

    if (newName !== null && (newName.length === 0 || newName.length > 30)) {
        const reply = await interaction.reply({
            content: '❌ Tên mới phải có từ 1-30 ký tự!',
            ephemeral: true,
            fetchReply: true
        });
        autoDeleteReply(reply);
        return;
    }

    // Kiểm tra trùng tên với âm thanh khác (không phân biệt hoa thường)
    if (newName) {
        const existingKey = findMappingKey(mapping, newName);
        if (existingKey && existingKey !== displayName) {
            const reply = await interaction.reply({
                content: `❌ Âm thanh **${newName}** đã tồn tại! Hãy chọn tên khác.`,
                ephemeral: true,
                fetchReply: true
            });
            autoDeleteReply(reply);
            return;
        }
    }

    try {
        const finalName = newName || displayName;
        const finalVolume = newVolume ?? entry.volume;

        delete mapping[displayName];
        mapping[finalName] = { file: entry.file, volume: finalVolume };
        saveMapping(mapping);

        const changes = [];
        if (newName && newName !== displayName) {
            changes.push(`Tên: **${displayName}** → **${finalName}**`);
        }
        if (newVolume !== null && newVolume !== entry.volume) {
            changes.push(`Âm lượng: **${entry.volume}%** → **${finalVolume}%**`);
        }

        const reply = await interaction.reply({
            content: changes.length > 0
                ? `✅ Đã cập nhật âm thanh!\n${changes.join('\n')}`
                : `ℹ️ Không có thay đổi nào cho **${displayName}**.`,
            ephemeral: true,
            fetchReply: true
        });
        autoDeleteReply(reply);
    } catch (error) {
        console.error('Error editing soundboard entry:', error);
        const reply = await interaction.reply({
            content: '❌ Có lỗi xảy ra khi sửa âm thanh!',
            ephemeral: true,
            fetchReply: true
        });
        autoDeleteReply(reply);
    }
}

async function handleRemove(interaction) {
    // Kiểm tra quyền
    const member = interaction.member;
    const hasPower = member?.permissions?.has(PermissionsBitField.Flags.Administrator) ||
                     member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);

    if (!hasPower) {
        const reply = await interaction.reply({
            content: '❌ Bạn cần quyền **Administrator** hoặc **Manage Server** để xóa âm thanh!',
            ephemeral: true,
            fetchReply: true
        });
        autoDeleteReply(reply);
        return;
    }

    const displayName = interaction.options.getString('name');

    // Tìm file name từ mapping
    const mapping = loadMapping();
    const fileName = getEntry(mapping, displayName)?.file;

    if (!fileName) {
        const reply = await interaction.reply({
            content: `❌ Không tìm thấy âm thanh **${displayName}**!`,
            ephemeral: true,
            fetchReply: true
        });
        autoDeleteReply(reply);
        return;
    }

    const filePath = path.join(SOUNDBOARD_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        const reply = await interaction.reply({
            content: `❌ File âm thanh không tồn tại!`,
            ephemeral: true,
            fetchReply: true
        });
        autoDeleteReply(reply);
        return;
    }

    try {
        // Xóa file
        fs.unlinkSync(filePath);
        
        // Xóa khỏi mapping
        delete mapping[displayName];
        saveMapping(mapping);
        
        const reply = await interaction.reply({
            content: `✅ Đã xóa âm thanh **${displayName}**!`,
            ephemeral: true,
            fetchReply: true
        });
        autoDeleteReply(reply);
    } catch (error) {
        console.error('Error removing soundboard file:', error);
        const reply = await interaction.reply({
            content: '❌ Có lỗi xảy ra khi xóa file!',
            ephemeral: true,
            fetchReply: true
        });
        autoDeleteReply(reply);
    }
}

async function handleList(interaction) {
    const sounds = getSoundList();

    if (sounds.length === 0) {
        const reply = await interaction.reply({
            content: '❌ Chưa có âm thanh nào!',
            ephemeral: true,
            fetchReply: true
        });
        autoDeleteReply(reply);
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle('📋 Danh sách Soundboard')
        .setDescription(sounds.map((s, i) => `${i + 1}. **${s.displayName}** (${s.ext}) — 🔉 ${s.volume}%`).join('\n'))
        .setColor('#00ff00')
        .setFooter({ text: `Tổng: ${sounds.length} âm thanh` })
        .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function playSound(interaction, displayName) {
    const member = interaction.member;
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
        const reply = await interaction.reply({
            content: '❌ Bạn phải ở trong voice channel!',
            ephemeral: true,
            fetchReply: true
        });
        autoDeleteReply(reply);
        return;
    }

    // Tìm file name từ mapping
    const mapping = loadMapping();
    const entry = getEntry(mapping, displayName);

    if (!entry) {
        const reply = await interaction.reply({
            content: `❌ Không tìm thấy âm thanh **${displayName}**!`,
            ephemeral: true,
            fetchReply: true
        });
        autoDeleteReply(reply);
        return;
    }

    const filePath = path.join(SOUNDBOARD_DIR, entry.file);

    if (!fs.existsSync(filePath)) {
        const reply = await interaction.reply({
            content: `❌ File âm thanh không tồn tại!`,
            ephemeral: true,
            fetchReply: true
        });
        autoDeleteReply(reply);
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;

    // Khởi tạo queue nếu chưa có
    if (!audioQueues.has(guildId)) {
        audioQueues.set(guildId, {
            queue: [],
            isPlaying: false,
            connection: null,
            player: null
        });
    }

    const queueData = audioQueues.get(guildId);

    // Thêm vào queue
    queueData.queue.push({
        displayName,
        filePath,
        volume: entry.volume,
        voiceChannel,
        interaction
    });

    // Bắt đầu xử lý queue nếu chưa đang phát
    if (!queueData.isPlaying) {
        processQueue(guildId);
    } else {
        // Nếu đang phát, chỉ acknowledge interaction rồi xóa sau 5s
        await interaction.editReply({
            content: `⏳ Đang xử lý...`
        });
        setTimeout(() => {
            interaction.deleteReply().catch(() => {});
        }, 5000);
    }
}

async function processQueue(guildId) {
    const queueData = audioQueues.get(guildId);
    if (!queueData || queueData.queue.length === 0) {
        queueData.isPlaying = false;
        return;
    }

    queueData.isPlaying = true;
    const { displayName, filePath, volume, voiceChannel, interaction } = queueData.queue.shift();

    try {
        // Tạo hoặc lấy connection
        let connection = queueData.connection;

        if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator
            });
            queueData.connection = connection;
        }

        // Đợi connection sẵn sàng
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

        // Tạo player nếu chưa có
        if (!queueData.player) {
            queueData.player = createAudioPlayer();
        }

        const player = queueData.player;

        // Tạo audio resource với âm lượng tùy chỉnh
        const resource = createAudioResource(filePath, { inlineVolume: true });
        resource.volume.setVolume(volume / 100);
        player.play(resource);
        connection.subscribe(player);

        // Gửi thông báo đang phát và tự xóa sau 5s
        try {
            if (interaction.deferred) {
                const reply = await interaction.editReply({
                    content: `🔊 Đang phát: **${displayName}**`
                });
                autoDeleteReply(reply);
            } else {
                const reply = await interaction.followUp({
                    content: `🔊 Đang phát: **${displayName}**`,
                    ephemeral: true
                });
                autoDeleteReply(reply);
            }
        } catch (error) {
            // Bỏ qua lỗi nếu không thể gửi tin nhắn
        }

        // Đợi âm thanh phát xong
        await new Promise((resolve) => {
            player.once(AudioPlayerStatus.Idle, resolve);
            setTimeout(resolve, 30000); // Timeout 30s
        });

    } catch (error) {
        console.error('Error playing sound:', error);
        try {
            const reply = await interaction.followUp({
                content: `❌ Lỗi khi phát **${displayName}**!`,
                ephemeral: true
            });
            autoDeleteReply(reply);
        } catch (err) {
            // Bỏ qua lỗi
        }
    }

    // Xử lý âm thanh tiếp theo
    setTimeout(() => processQueue(guildId), 500);
}