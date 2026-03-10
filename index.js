const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { token } = require('./config/config.js');
const fs = require('fs');
const path = require('path');

module.exports = { runBot }

async function runBot(onReady) {

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.GuildPresences,
            GatewayIntentBits.GuildMembers
        ]
    });

    client.commands = new Collection();

    function loadCommands() {
        const commandsPath = path.join(__dirname, 'commands');
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);
            const command = require(filePath);
            if ('data' in command && 'execute' in command) {
                client.commands.set(command.data.name, command);
            } else {
                console.log(`[WARNING] Command ${filePath} thiếu "data" hoặc "execute"`);
            }
        }
    }
    loadCommands();

    function loadEvents() {
        const eventsPath = path.join(__dirname, 'events');
        const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
        for (const file of eventFiles) {
            const filePath = path.join(eventsPath, file);
            const event = require(filePath);
            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args));
            } else {
                client.on(event.name, (...args) => event.execute(...args));
            }
        }
    }
    loadEvents();

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        const command = client.commands.get(interaction.commandName);
        if (!command) {
            console.error(`Command ${interaction.commandName} không tồn tại.`);
            return;
        }
        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`Lỗi khi thực thi command ${interaction.commandName}:`, error);
            const errorMessage = 'Có lỗi xảy ra khi thực thi command này!';
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    });

    client.on("messageCreate", async (message) => {
        let channelID = message.channelId;
        let content = message.content;
        const musicChannel = 1381557978410389565;

        if (channelID == musicChannel || channelID == 1437793347681910806) return;
        if (!content.includes("m!p") && !content.includes("m!play")) return;

        const currentChannel = message.guild.channels.cache.get(channelID);
        if (currentChannel) {
            const message1 = await currentChannel.send(` Con vợ <@${message.author.id}> bật nhạc láo vl`);
            const message2 = await currentChannel.send(`Xóa mẹ tin nhắn trong 10s.... zzzz`);
            setTimeout(async () => {
                kickBot(message);
                message2.delete().catch(console.error);
                message1.delete().catch(console.error);
            }, 3000);
        }
        messageHandler(message);
    });

    if (!token) {
        console.error("❌ LỖI NGHIÊM TRỌNG: KHÔNG TÌM THẤY DISCORD_TOKEN. Vui lòng thêm biến DISCORD_TOKEN vào mục Environment Variables trên Dashboard của Render.");
        process.exit(1);
    }

    client.on('debug', console.log);
    client.on('warn', console.warn);
    client.on('error', console.error);

    try {
        console.log("⏳ Đang gửi request login tới Discord API...");
        await client.login(token);
        console.log(`✅ Đã pass bước login. Discord user: ${client.user?.tag}`);
        if (typeof onReady === 'function') onReady();
    } catch (err) {
        console.error("❌ Lỗi CỰC KỲ NGHIÊM TRỌNG khi login Discord! Có thể Token đã bị reset:", err);
    }
    function messageHandler(message) {
        setTimeout(async () => {
            try {
                await message.delete();
            } catch (error) {
                console.error("Không thể xóa tin nhắn");
            }
        }, 5000);
    }

    function kickBot(message) {
        const member = message.guild.members.cache.get('411916947773587456');
        if (member && member.voice.channel) {
            member.voice.setChannel(null)
                .then(() => console.log(`Đã kick ${member.user.tag} khỏi voice channel.`))
                .catch(console.error);
        } else {
            console.log("Người dùng không ở trong voice channel.");
        }
    }
}