const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus
} = require('@discordjs/voice');
const gTTS = require('gtts');

// Map để track voice channel đang được sử dụng
const activeChannels = new Map();

// Queue cho mỗi voice channel
const channelQueues = new Map();

// Lưu player và connection để có thể stop
const activePlayers = new Map();
const activeConnections = new Map();

// File lưu từ viết tắt
const ABBREVIATIONS_FILE = path.join(__dirname, '../data', 'abbreviations.json');

// Load từ viết tắt từ file
function loadAbbreviations() {
  try {
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (fs.existsSync(ABBREVIATIONS_FILE)) {
      const data = fs.readFileSync(ABBREVIATIONS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Lỗi khi load từ viết tắt:', error);
  }
  return {};
}

// Save từ viết tắt vào file
function saveAbbreviations(abbreviations) {
  try {
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(ABBREVIATIONS_FILE, JSON.stringify(abbreviations, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Lỗi khi save từ viết tắt:', error);
    return false;
  }
}

// Helper function để escape các ký tự đặc biệt trong regex
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Lấy "biệt danh" của người dùng: nickname (server) -> globalName -> username
function getDisplayName(member) {
  return member?.nickname
    || member?.user?.globalName
    || member?.user?.username
    || 'Unknown';
}

// Thay thế từ viết tắt trong text (Unicode-safe, không cần lookbehind)
function expandAbbreviations(text) {
  const abbreviations = loadAbbreviations();
  let expandedText = text;

  // Sắp xếp theo độ dài giảm dần để tránh thay thế nhầm (vd: "k" và "ko")
  const sortedAbbrs = Object.keys(abbreviations).sort((a, b) => b.length - a.length);

  for (const abbr of sortedAbbrs) {
    const fullForm = abbreviations[abbr];
    const escaped = escapeRegex(abbr);

    // Boundary Unicode-safe:
    // (^|[không phải chữ/số]) + (abbr) + (?=[không phải chữ/số]|$)
    // Dùng 'u' để hỗ trợ \p{...}
    const regex = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=[^\\p{L}\\p{N}]|$)`, 'gu');

    expandedText = expandedText.replace(regex, (match, prefix) => `${prefix}${fullForm}`);
  }

  return expandedText;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('r')
    .setDescription('Bot sẽ nói lại đoạn text bạn nhập')
    .addSubcommand(subcommand =>
      subcommand
        .setName('say')
        .setDescription('Bot nói text của bạn')
        .addStringOption(option =>
          option.setName('text')
            .setDescription('Đoạn text bạn muốn bot nói')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Thêm từ viết tắt')
        .addStringOption(option =>
          option.setName('abbreviation')
            .setDescription('Từ viết tắt (ví dụ: T, m, k)')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('fullform')
            .setDescription('Từ đầy đủ (ví dụ: Tao, mày, không)')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('Hiển thị danh sách từ viết tắt')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Xóa từ viết tắt')
        .addStringOption(option =>
          option.setName('abbreviation')
            .setDescription('Từ viết tắt muốn xóa (để trống để xem danh sách)')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'add') {
      await handleAddAbbreviation(interaction);
    } else if (subcommand === 'list') {
      await handleListAbbreviations(interaction);
    } else if (subcommand === 'remove') {
      await handleRemoveAbbreviation(interaction);
    } else if (subcommand === 'say') {
      await handleSayCommand(interaction);
    }
  }
};

async function handleAddAbbreviation(interaction) {
  await interaction.deferReply();

  const abbreviation = interaction.options.getString('abbreviation');
  const fullForm = interaction.options.getString('fullform');

  const abbrTrimmed = abbreviation.trim();
  const fullTrimmed = fullForm.trim();

  if (!abbrTrimmed || !fullTrimmed) {
    return await interaction.editReply('❌ Từ viết tắt và từ đầy đủ không được để trống!');
  }

  const abbreviations = loadAbbreviations();

  // Kiểm tra xung đột
  if (abbreviations[abbrTrimmed]) {
    return await interaction.editReply(
      `⚠️ Từ viết tắt **${abbrTrimmed}** đã tồn tại với nghĩa: **${abbreviations[abbrTrimmed]}**\n\n` +
      `Vui lòng xóa từ cũ trước hoặc dùng từ viết tắt khác!`
    );
  }

  abbreviations[abbrTrimmed] = fullTrimmed;

  if (saveAbbreviations(abbreviations)) {
    await interaction.editReply(`✅ Đã thêm từ viết tắt: **${abbrTrimmed}** → **${fullTrimmed}**`);
  } else {
    await interaction.editReply('❌ Có lỗi khi lưu từ viết tắt!');
  }
}

async function handleListAbbreviations(interaction) {
  await interaction.deferReply();

  const abbreviations = loadAbbreviations();
  const entries = Object.entries(abbreviations);

  if (entries.length === 0) {
    return await interaction.editReply('📝 Chưa có từ viết tắt nào được thêm!');
  }

  let message = '📝 **Danh sách từ viết tắt:**\n\n';
  entries.forEach(([abbr, full], index) => {
    message += `${index + 1}. **${abbr}** → ${full}\n`;
  });

  // Chia nhỏ nếu message quá dài (Discord limit 2000 ký tự)
  if (message.length > 2000) {
    message = message.substring(0, 1900) + '\n\n... (và nhiều hơn nữa)';
  }

  await interaction.editReply(message);
}

async function handleRemoveAbbreviation(interaction) {
  await interaction.deferReply();

  const abbreviations = loadAbbreviations();
  const entries = Object.entries(abbreviations);

  if (entries.length === 0) {
    return await interaction.editReply('📝 Chưa có từ viết tắt nào để xóa!');
  }

  const abbreviation = interaction.options.getString('abbreviation');

  // Nếu không có parameter abbreviation, hiển thị list để chọn
  if (!abbreviation) {
    let message = '📝 **Chọn từ viết tắt muốn xóa:**\n\n';
    entries.forEach(([abbr, full], index) => {
      message += `${index + 1}. **${abbr}** → ${full}\n`;
    });
    message += '\n💡 Sử dụng: `/r remove abbreviation:<từ_viết_tắt>`';

    if (message.length > 2000) {
      message = message.substring(0, 1900) + '\n\n... (và nhiều hơn nữa)';
    }

    return await interaction.editReply(message);
  }

  const abbrTrimmed = abbreviation.trim();

  if (!abbreviations[abbrTrimmed]) {
    let message = `❌ Không tìm thấy từ viết tắt **${abbrTrimmed}**!\n\n📝 **Danh sách từ viết tắt hiện có:**\n\n`;
    entries.forEach(([abbr, full], index) => {
      message += `${index + 1}. **${abbr}** → ${full}\n`;
    });

    if (message.length > 2000) {
      message = message.substring(0, 1900) + '\n\n... (và nhiều hơn nữa)';
    }

    return await interaction.editReply(message);
  }

  const fullForm = abbreviations[abbrTrimmed];
  delete abbreviations[abbrTrimmed];

  if (saveAbbreviations(abbreviations)) {
    await interaction.editReply(`✅ Đã xóa từ viết tắt: **${abbrTrimmed}** → **${fullForm}**`);
  } else {
    await interaction.editReply('❌ Có lỗi khi xóa từ viết tắt!');
  }
}

async function handleSayCommand(interaction) {
  await interaction.deferReply();

  const member = interaction.member;
  const voiceChannel = member.voice.channel;

  if (!voiceChannel) {
    return await interaction.editReply('Bạn cần vào voice channel trước!');
  }

  const callerName = getDisplayName(member);

  const originalText = interaction.options.getString('text');
  const channelId = voiceChannel.id;

  // Kiểm tra nếu là lệnh shutup
  if (originalText.toLowerCase().trim() === 'shutup') {
    await handleShutupCommand(interaction, channelId, voiceChannel);
    return;
  }

  // Kiểm tra nếu text chứa "truongcaytv" (không phân biệt hoa thường)
  if (originalText.toLowerCase().includes('truongcaytv')) {
    await handleSpecialSound(interaction, channelId, voiceChannel, 'test.mp3', originalText);
    return;
  }

  // Thay thế từ viết tắt
  const expandedText = expandAbbreviations(originalText);

  // Text đưa vào TTS theo format yêu cầu
  const ttsText = `${callerName} đã nói: ${expandedText}`;

  // Thêm vào queue
  if (!channelQueues.has(channelId)) {
    channelQueues.set(channelId, []);
  }

  const queue = channelQueues.get(channelId);
  queue.push({
    interaction,
    text: ttsText,              // dùng để TTS
    expandedText: expandedText,  // dùng để hiển thị
    originalText: originalText,  // giữ để hiển thị map viết tắt
    member,
    voiceChannel
  });

  // Nếu đang phát thì thông báo đã thêm vào hàng đợi
  if (activeChannels.get(channelId)) {
    let replyMsg = `✅ **${callerName}** đã thêm vào hàng đợi (vị trí: ${queue.length})`;
    if (expandedText !== originalText) {
      replyMsg += `\n📝 **${originalText}** → **${expandedText}**`;
    }
    await interaction.editReply(replyMsg);
    return;
  }

  // Nếu không có gì đang phát, bắt đầu process queue
  await processQueue(channelId);
}

async function handleSpecialSound(interaction, channelId, voiceChannel, soundFileName, originalText) {
  try {
    const callerName = getDisplayName(interaction.member);

    // Đường dẫn file âm thanh đặc biệt
    const soundFilePath = path.join(__dirname, '../sounds', soundFileName);

    // Kiểm tra file có tồn tại không
    if (!fs.existsSync(soundFilePath)) {
      await interaction.editReply(`❌ Không tìm thấy file ${soundFileName} trong thư mục sounds!`);
      return;
    }

    console.log(`Đang phát file ${soundFileName}...`);

    // Join voice channel (hoặc sử dụng connection hiện tại)
    let connection = activeConnections.get(channelId);
    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
      connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator
      });
      activeConnections.set(channelId, connection);
    }

    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

    const player = createAudioPlayer();
    activePlayers.set(channelId, player);

    const resource = createAudioResource(soundFilePath);

    player.play(resource);
    connection.subscribe(player);

    await interaction.editReply(`🎵 **${callerName}**: "${originalText}" - Phát âm thanh đặc biệt!`);

    // Khi phát xong
    player.once(AudioPlayerStatus.Idle, async () => {
      console.log(`Đã phát xong ${soundFileName}`);

      activeChannels.delete(channelId);
      activePlayers.delete(channelId);

      // Xóa tin nhắn reply
      setTimeout(async () => {
        try {
          await interaction.deleteReply();
        } catch (error) {
          console.error('Không thể xóa tin nhắn:', error);
        }
      }, 2000);
    });

    player.once('error', error => {
      console.error('Lỗi audio player:', error);
      activeChannels.delete(channelId);
      activePlayers.delete(channelId);
    });

  } catch (error) {
    console.error('Lỗi khi xử lý âm thanh đặc biệt:', error);
    await interaction.editReply('❌ Có lỗi xảy ra khi phát âm thanh đặc biệt!');
    activeChannels.delete(channelId);
    activePlayers.delete(channelId);
  }
}

async function handleShutupCommand(interaction, channelId, voiceChannel) {
  try {
    const callerName = getDisplayName(interaction.member);

    // Dừng player hiện tại nếu có
    const currentPlayer = activePlayers.get(channelId);
    if (currentPlayer) {
      currentPlayer.stop();
      console.log('Đã dừng player hiện tại');
    }

    // Xóa toàn bộ queue
    const queue = channelQueues.get(channelId);
    const queueLength = queue ? queue.length : 0;
    channelQueues.set(channelId, []);
    console.log(`Đã xóa ${queueLength} lệnh trong hàng đợi`);

    // Đường dẫn file shutup.mp3
    const shutupFilePath = path.join(__dirname, '../sounds', 'shutup.mp3');

    // Kiểm tra file có tồn tại không
    if (!fs.existsSync(shutupFilePath)) {
      await interaction.editReply('❌ Không tìm thấy file shutup.mp3 trong thư mục sounds!');
      activeChannels.delete(channelId);
      activePlayers.delete(channelId);
      return;
    }

    console.log('Đang phát file shutup.mp3...');

    // Join voice channel (hoặc sử dụng connection hiện tại)
    let connection = activeConnections.get(channelId);
    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
      connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator
      });
      activeConnections.set(channelId, connection);
    }

    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

    const player = createAudioPlayer();
    activePlayers.set(channelId, player);

    const resource = createAudioResource(shutupFilePath);

    player.play(resource);
    connection.subscribe(player);

    await interaction.editReply(`🛑 **${callerName}** đã dừng tất cả và xóa ${queueLength} lệnh trong hàng đợi!`);

    // Khi phát xong shutup.mp3
    player.once(AudioPlayerStatus.Idle, async () => {
      console.log('Đã phát xong shutup.mp3');

      console.log('Bot vẫn ở trong voice channel sau lệnh shutup');
      activeChannels.delete(channelId);
      activePlayers.delete(channelId);

      // Xóa tin nhắn reply
      setTimeout(async () => {
        try {
          await interaction.deleteReply();
        } catch (error) {
          console.error('Không thể xóa tin nhắn:', error);
        }
      }, 2000);
    });

    player.once('error', error => {
      console.error('Lỗi audio player:', error);
      activeChannels.delete(channelId);
      activePlayers.delete(channelId);
    });

  } catch (error) {
    console.error('Lỗi khi xử lý lệnh shutup:', error);
    await interaction.editReply('❌ Có lỗi xảy ra khi xử lý lệnh shutup!');
    activeChannels.delete(channelId);
    activePlayers.delete(channelId);
  }
}

async function processQueue(channelId) {
  const queue = channelQueues.get(channelId);

  if (!queue || queue.length === 0) {
    activeChannels.delete(channelId);
    channelQueues.delete(channelId);
    activePlayers.delete(channelId);
    console.log('Hết queue nhưng bot vẫn ở trong voice channel');
    return;
  }

  // Đánh dấu channel đang active
  activeChannels.set(channelId, true);

  const { interaction, text, expandedText, originalText, member, voiceChannel } = queue.shift();
  const callerName = getDisplayName(member);

  const filePath = path.join(__dirname, '../sounds', `repeat_${member.id}_${Date.now()}.mp3`);

  // Kiểm tra và tạo thư mục sounds nếu chưa có
  const soundsDir = path.join(__dirname, '../sounds');
  if (!fs.existsSync(soundsDir)) {
    fs.mkdirSync(soundsDir, { recursive: true });
  }

  try {
    // Tạo file audio
    console.log('Bắt đầu tạo file TTS...');
    const gtts = new gTTS(text, 'vi'); // text đã là "Biệt danh đã nói: ..."

    await new Promise((resolve, reject) => {
      gtts.save(filePath, function (err, result) {
        if (err) {
          console.error('Lỗi khi tạo TTS:', err);
          reject(err);
          return;
        }
        console.log(`Đã tạo file audio: ${filePath}`);
        resolve(result);
      });
    });

    // Kiểm tra file
    if (!fs.existsSync(filePath)) {
      throw new Error('File audio không được tạo thành công');
    }

    const fileSize = fs.statSync(filePath).size;
    console.log(`Kích thước file: ${fileSize} bytes`);

    if (fileSize < 1000) {
      throw new Error('File audio quá nhỏ, có thể bị lỗi');
    }

    // Join voice channel
    let connection = activeConnections.get(channelId);
    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
      connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator
      });
      activeConnections.set(channelId, connection);
    }

    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

    const player = createAudioPlayer();
    activePlayers.set(channelId, player);

    const resource = createAudioResource(filePath);

    player.play(resource);
    connection.subscribe(player);

    // Hiển thị UI theo expandedText (không hiển thị cả "đã nói" trong message nếu bạn không muốn)
    const shownText = expandedText ?? text;
    let replyMsg = `🔊 **${callerName}** đang nói: "${shownText.substring(0, 100)}${shownText.length > 100 ? '...' : ''}"`;
    if (expandedText && expandedText !== originalText) {
      replyMsg += `\n📝 (từ: "${originalText}")`;
    }
    await interaction.editReply(replyMsg);

    // Khi phát xong
    player.once(AudioPlayerStatus.Idle, async () => {
      console.log('Đã phát xong audio');

      // Xóa file
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            console.log(`Đã xóa file: ${filePath}`);
          } catch (err) {
            console.error('Lỗi khi xóa file:', err);
          }
        }
      }, 1000);

      // Xóa tin nhắn reply
      setTimeout(async () => {
        try {
          await interaction.deleteReply();
        } catch (error) {
          console.error('Không thể xóa tin nhắn:', error);
        }
      }, 2000);

      // Kiểm tra xem còn gì trong queue không
      const remainingQueue = channelQueues.get(channelId);
      if (remainingQueue && remainingQueue.length > 0) {
        console.log(`Còn ${remainingQueue.length} lệnh trong hàng đợi`);
        setTimeout(() => {
          processQueue(channelId);
        }, 500);
      } else {
        console.log('Hết queue - Bot vẫn ở trong voice channel');
        activeChannels.delete(channelId);
        channelQueues.delete(channelId);
        activePlayers.delete(channelId);
      }
    });

    // Xử lý lỗi
    player.once('error', error => {
      console.error('Lỗi audio player:', error);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch {}
      }

      // Tiếp tục queue kế tiếp
      activeChannels.delete(channelId);
      activePlayers.delete(channelId);
      setTimeout(() => processQueue(channelId), 1000);
    });

  } catch (error) {
    console.error('Lỗi khi phát audio:', error);
    await interaction.editReply('❌ Có lỗi xảy ra khi tạo/phát audio! Vui lòng thử lại.');

    // Xóa file nếu có lỗi
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error('Lỗi khi xóa file:', err);
      }
    }

    // Tiếp tục queue kế tiếp
    activeChannels.delete(channelId);
    activePlayers.delete(channelId);
    setTimeout(() => processQueue(channelId), 1000);
  }
}