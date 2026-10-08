const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ComponentType
} = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    StreamType,
    entersState
} = require('@discordjs/voice');
const axios = require('axios');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { ensureYtDlp, searchYouTube, getVideoInfo, spawnAudioStream } = require('../utils/ytdlp');

// Phiên karaoke đang chạy theo guild
const sessions = new Map();

// Hiển thị câu sớm hơn một chút để bù độ trễ khi edit tin nhắn
const LEAD_MS = 400;
// Khoảng cách tối thiểu giữa 2 lần edit (tránh rate limit Discord)
const MIN_EDIT_INTERVAL = 1000;
const OFFSET_STEP = 500;
const MAX_DURATION = 15 * 60;

// Tải sẵn yt-dlp khi bot khởi động để lần hát đầu không phải chờ
ensureYtDlp().catch(err => console.error('Không tải được yt-dlp:', err.message));

// =========================
//  TÌM NHẠC
// =========================
async function findTrack(query, mode) {
    if (/^https?:\/\//i.test(query)) {
        return getVideoInfo(query);
    }

    const searchQuery = mode === 'original' ? query : `${query} karaoke`;
    const results = (await searchYouTube(searchQuery, 8))
        .filter(v => v.duration > 0 && v.duration <= MAX_DURATION);
    if (results.length === 0) return null;

    if (mode === 'original') return results[0];

    // Ưu tiên video có chữ karaoke/beat trong tiêu đề
    return results.find(v => /karaoke|beat|instrumental/i.test(v.title)) || results[0];
}

// =========================
//  LỜI BÀI HÁT (LRCLIB)
// =========================

// Bỏ các từ thừa trong tên/tiêu đề để tìm lời chính xác hơn
function cleanSongName(text) {
    return text
        .replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, ' ')
        .replace(/karaoke|beat|instrumental|tone\s*(nam|nữ|nu|gốc|goc)|full\s*hd|hd|mv|official|lyrics?|video|music/gi, ' ')
        .replace(/[|｜]/g, ' - ')
        .replace(/\s{2,}/g, ' ')
        .replace(/^[\s-]+|[\s-]+$/g, '')
        .trim();
}

// Thử lần lượt: tên đầy đủ, 2 đoạn đầu, đoạn đầu (tiêu đề video hay kèm tên kênh ở cuối)
async function findLyrics(name, duration) {
    const segments = name.split(/\s+-\s+/).filter(Boolean);
    const candidates = [...new Set([
        name,
        segments.slice(0, 2).join(' '),
        segments[0]
    ].filter(Boolean))];

    for (const query of candidates) {
        const lyrics = await fetchLyrics(query, duration);
        if (lyrics) return lyrics;
    }
    return null;
}

async function fetchLyrics(query, duration) {
    const res = await axios.get('https://lrclib.net/api/search', {
        params: { q: query },
        headers: { 'User-Agent': 'xuanha-bot karaoke (https://github.com)' },
        timeout: 10000
    });
    const items = Array.isArray(res.data) ? res.data : [];
    if (items.length === 0) return null;

    const synced = items.filter(i => i.syncedLyrics);
    if (synced.length > 0) {
        // Chọn bản có thời lượng gần với video nhất
        if (duration) {
            synced.sort((a, b) => Math.abs(a.duration - duration) - Math.abs(b.duration - duration));
        }
        return { ...synced[0], lines: parseLrc(synced[0].syncedLyrics) };
    }

    const plain = items.find(i => i.plainLyrics);
    return plain ? { ...plain, lines: null } : null;
}

// Parse LRC: "[mm:ss.xx] lời" -> [{ time (ms), text }]
function parseLrc(lrc) {
    const lines = [];
    let offset = 0;

    for (const raw of lrc.split(/\r?\n/)) {
        const offsetMatch = raw.match(/^\[offset:\s*([+-]?\d+)\]/i);
        if (offsetMatch) {
            offset = parseInt(offsetMatch[1], 10);
            continue;
        }

        const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
        if (stamps.length === 0) continue;
        const text = raw.replace(/\[[^\]]*\]/g, '').trim();

        for (const s of stamps) {
            const time = Math.round((parseInt(s[1], 10) * 60 + parseFloat(s[2])) * 1000);
            lines.push({ time, text });
        }
    }

    return lines
        .map(l => ({ time: l.time - offset, text: l.text }))
        .sort((a, b) => a.time - b.time);
}

// =========================
//  PHÁT AUDIO
// =========================
async function createKaraokeResource(url) {
    const ytdlp = await spawnAudioStream(url);
    const ffmpeg = spawn(ffmpegPath, [
        '-loglevel', 'error',
        '-i', 'pipe:0',
        '-vn',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1'
    ], { windowsHide: true });

    let ytdlpError = '';
    ytdlp.stderr.on('data', d => { ytdlpError += d; });
    ytdlp.on('close', code => {
        if (code && code !== 0 && ytdlpError) console.error('yt-dlp lỗi:', ytdlpError.trim());
    });

    ytdlp.stdout.pipe(ffmpeg.stdin);
    // Bỏ qua EPIPE khi dừng giữa chừng
    ytdlp.stdout.on('error', () => {});
    ffmpeg.stdin.on('error', () => {});

    const resource = createAudioResource(ffmpeg.stdout, {
        inputType: StreamType.Raw,
        inlineVolume: true
    });

    return { resource, processes: [ytdlp, ffmpeg], getError: () => ytdlpError.trim() };
}

// =========================
//  HIỂN THỊ
// =========================
function formatTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = String(total % 60).padStart(2, '0');
    return `${m}:${s}`;
}

function progressBar(current, total, size = 16) {
    if (!total) return '';
    const ratio = Math.min(1, current / total);
    const pos = Math.min(size - 1, Math.floor(ratio * size));
    return '▬'.repeat(pos) + '🔘' + '▬'.repeat(size - pos - 1);
}

function displayLine(text) {
    return text || '♪ ♪ ♪';
}

// Chỉ số câu đang hát tại thời điểm `ms` (-1 nếu đang dạo nhạc)
function currentLineIndex(lines, ms) {
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].time <= ms) idx = i;
        else break;
    }
    return idx;
}

function buildEmbed(session) {
    const { track, lyrics, offsetMs } = session;
    const position = session.resource ? session.resource.playbackDuration : 0;
    const durationMs = track.duration * 1000;

    const embed = new EmbedBuilder()
        .setColor(session.paused ? 0x95a5a6 : 0xe91e63)
        .setTitle(`🎤 ${track.title}`.slice(0, 256))
        .setURL(track.url);

    let description;
    if (!lyrics) {
        description = '😢 Không tìm thấy lời cho bài này, hát theo trí nhớ nhé!';
    } else if (!lyrics.lines) {
        description = `-# Không có lời chạy theo nhạc, hiển thị toàn bộ lời:\n\n${lyrics.plainLyrics}`;
    } else {
        const lines = lyrics.lines;
        const idx = currentLineIndex(lines, position + offsetMs + LEAD_MS);
        const parts = [];

        if (idx === -1) {
            const waitMs = lines[0].time - (position + offsetMs);
            parts.push(`### 🎶 Dạo nhạc... (${formatTime(waitMs)})`);
        } else {
            for (let i = Math.max(0, idx - 2); i < idx; i++) {
                parts.push(`-# ${displayLine(lines[i].text)}`);
            }
            parts.push(`### ▶ ${displayLine(lines[idx].text)}`);
        }

        for (let i = idx + 1; i < Math.min(lines.length, idx + 4); i++) {
            parts.push(displayLine(lines[i].text));
        }
        description = parts.join('\n');
    }
    embed.setDescription(description.slice(0, 4096));

    const status = session.paused ? '⏸ Tạm dừng' : '▶ Đang phát';
    const footer = [
        `${status}  ${formatTime(position)} / ${formatTime(durationMs)}`,
        progressBar(position, durationMs),
        lyrics ? `Lời: ${lyrics.artistName} - ${lyrics.trackName}` : null,
        lyrics?.lines ? `Lệch lời: ${offsetMs >= 0 ? '+' : ''}${(offsetMs / 1000).toFixed(1)}s` : null,
        `Yêu cầu bởi ${session.requestedBy}`
    ].filter(Boolean);
    embed.setFooter({ text: footer.join('\n') });

    return embed;
}

function buildButtons(session, disabled = false) {
    const hasSync = !!session.lyrics?.lines;
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('karaoke:pause')
                .setEmoji(session.paused ? '▶️' : '⏸️')
                .setLabel(session.paused ? 'Tiếp tục' : 'Tạm dừng')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId('karaoke:earlier')
                .setEmoji('⏪')
                .setLabel('Lời sớm hơn')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || !hasSync),
            new ButtonBuilder()
                .setCustomId('karaoke:later')
                .setEmoji('⏩')
                .setLabel('Lời muộn hơn')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled || !hasSync),
            new ButtonBuilder()
                .setCustomId('karaoke:stop')
                .setEmoji('⏹️')
                .setLabel('Dừng')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(disabled)
        )
    ];
}

// Edit tin nhắn karaoke, có throttle để không bị rate limit
async function render(session, force = false) {
    if (session.ended) return;
    if (session.editing) {
        // Đang edit dở thì đánh dấu để render lại ngay sau đó
        if (force) session.dirty = true;
        return;
    }
    const now = Date.now();
    if (!force && now - session.lastEdit < MIN_EDIT_INTERVAL) return;

    session.editing = true;
    session.lastEdit = now;
    try {
        await session.message.edit({
            embeds: [buildEmbed(session)],
            components: buildButtons(session)
        });
    } catch (error) {
        console.error('Lỗi khi cập nhật lời karaoke:', error.message);
    } finally {
        session.editing = false;
    }
    if (session.dirty) {
        session.dirty = false;
        await render(session, true);
    }
}

function tick(session) {
    if (session.ended || session.paused) return;

    const position = session.resource ? session.resource.playbackDuration : 0;
    const lines = session.lyrics?.lines;
    const idx = lines ? currentLineIndex(lines, position + session.offsetMs + LEAD_MS) : 0;

    // Cập nhật khi đổi câu, hoặc mỗi 5s để thanh tiến trình/đếm ngược chạy
    if (idx !== session.lastIndex || Date.now() - session.lastEdit >= 5000) {
        if (Date.now() - session.lastEdit >= MIN_EDIT_INTERVAL && !session.editing) {
            session.lastIndex = idx;
            render(session);
        }
    }
}

// =========================
//  KẾT THÚC
// =========================
async function endSession(guildId, reason) {
    const session = sessions.get(guildId);
    if (!session || session.ended) return;
    session.ended = true;
    sessions.delete(guildId);

    clearInterval(session.timer);
    session.collector?.stop();
    for (const proc of session.processes) {
        try { proc.kill('SIGKILL'); } catch { /* đã thoát */ }
    }
    session.player.removeAllListeners();
    session.connection.off(VoiceConnectionStatus.Destroyed, session.onDestroyed);
    session.player.stop(true);

    const embed = buildEmbed(session)
        .setColor(0x2c3e50)
        .setDescription(reason)
        .setFooter({ text: `Yêu cầu bởi ${session.requestedBy}` });

    try {
        await session.message.edit({ embeds: [embed], components: buildButtons(session, true) });
    } catch (error) {
        console.error('Lỗi khi kết thúc karaoke:', error.message);
    }
}

function isKaraokeActive(guildId) {
    return sessions.has(guildId);
}

// =========================
//  COMMAND
// =========================
module.exports = {
    data: new SlashCommandBuilder()
        .setName('karaoke')
        .setDescription('Hát karaoke: bot phát nhạc beat và hiện lời chạy theo nhạc')
        .addStringOption(option =>
            option.setName('bai_hat')
                .setDescription('Tên bài hát (có thể kèm ca sĩ) hoặc link YouTube')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('che_do')
                .setDescription('Phát bản beat karaoke hay bài gốc (mặc định: beat)')
                .addChoices(
                    { name: 'Beat karaoke', value: 'karaoke' },
                    { name: 'Bài gốc (lời khớp nhất)', value: 'original' }
                )
        ),

    isKaraokeActive,

    async execute(interaction) {
        const query = interaction.options.getString('bai_hat').trim();
        const mode = interaction.options.getString('che_do') || 'karaoke';
        const voiceChannel = interaction.member?.voice?.channel;
        const guildId = interaction.guildId;

        if (!voiceChannel) {
            return interaction.reply({ content: '❌ Bạn cần vào voice channel trước!', ephemeral: true });
        }

        const existing = sessions.get(guildId);
        if (existing) {
            return interaction.reply({
                content: `🎤 Đang hát **${existing.track.title}**, bấm ⏹️ Dừng trước khi chọn bài mới nhé!`,
                ephemeral: true
            });
        }

        await interaction.deferReply();

        // Giữ chỗ để 2 người gọi cùng lúc không chồng nhau
        const pending = { ended: false, track: { title: query } };
        sessions.set(guildId, pending);

        let session;
        try {
            await interaction.editReply(`🔎 Đang tìm **${query}**...`);
            const track = await findTrack(query, mode);
            if (!track) {
                sessions.delete(guildId);
                return interaction.editReply(`❌ Không tìm thấy bài **${query}** trên YouTube.`);
            }

            // Từ link thì lấy tên từ tiêu đề video, còn lại dùng tên người dùng nhập
            const lyricsQuery = /^https?:\/\//i.test(query) ? cleanSongName(track.title) : cleanSongName(query);
            const lyrics = await findLyrics(lyricsQuery, track.duration).catch(err => {
                console.error('Lỗi khi tìm lời bài hát:', err.message);
                return null;
            });

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator
            });
            await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

            const player = createAudioPlayer();
            const { resource, processes, getError } = await createKaraokeResource(track.url);

            session = {
                guildId,
                track,
                lyrics,
                voiceChannelId: voiceChannel.id,
                requestedBy: interaction.member.displayName,
                connection,
                player,
                resource,
                processes,
                offsetMs: 0,
                paused: false,
                ended: false,
                editing: false,
                dirty: false,
                lastEdit: 0,
                lastIndex: null,
                message: null,
                timer: null,
                collector: null,
                onDestroyed: () => endSession(guildId, '👋 Bot đã rời voice channel.')
            };
            sessions.set(guildId, session);

            session.message = await interaction.editReply({
                content: '',
                embeds: [buildEmbed(session)],
                components: buildButtons(session)
            });

            player.on(AudioPlayerStatus.Idle, () => {
                // Dừng ngay từ đầu nghĩa là không stream được nhạc
                if (resource.playbackDuration < 3000) {
                    const err = getError();
                    console.error('Karaoke không phát được nhạc:', err);
                    return endSession(guildId, `❌ Không phát được nhạc.${/not a bot|Sign in/i.test(err) ? ' YouTube đang chặn bot, cần cấu hình cookies (YTDLP_COOKIES).' : ''}`);
                }
                endSession(guildId, '✅ Hết bài rồi! Hát hay lắm 👏');
            });
            player.on('error', error => {
                console.error('Lỗi audio player karaoke:', error);
                endSession(guildId, '❌ Có lỗi khi phát nhạc.');
            });
            connection.once(VoiceConnectionStatus.Destroyed, session.onDestroyed);

            player.play(resource);
            connection.subscribe(player);

            session.timer = setInterval(() => tick(session), 250);

            session.collector = session.message.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: (track.duration + 120) * 1000
            });
            session.collector.on('collect', i => handleButton(session, i));
        } catch (error) {
            console.error('Lỗi karaoke:', error);
            if (session) {
                await endSession(guildId, '❌ Có lỗi khi phát nhạc.');
            } else {
                sessions.delete(guildId);
            }
            const message = /Sign in to confirm|not a bot/i.test(error.message)
                ? '❌ YouTube đang chặn bot. Hãy cấu hình cookies (YTDLP_COOKIES) rồi thử lại.'
                : `❌ Lỗi khi mở karaoke: ${error.message.slice(0, 300)}`;
            await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
        }
    }
};

async function handleButton(session, i) {
    if (i.member?.voice?.channelId !== session.voiceChannelId) {
        return i.reply({ content: '❌ Bạn phải ở cùng voice channel mới điều khiển được!', ephemeral: true });
    }

    switch (i.customId) {
        case 'karaoke:pause':
            if (session.paused) {
                session.player.unpause();
                session.paused = false;
            } else {
                session.player.pause();
                session.paused = true;
            }
            break;
        case 'karaoke:earlier':
            session.offsetMs += OFFSET_STEP;
            break;
        case 'karaoke:later':
            session.offsetMs -= OFFSET_STEP;
            break;
        case 'karaoke:stop':
            await i.deferUpdate().catch(() => {});
            return endSession(session.guildId, `⏹️ ${i.member.displayName} đã dừng bài hát.`);
    }

    await i.deferUpdate().catch(() => {});
    await render(session, true);
}
