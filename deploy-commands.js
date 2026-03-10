const { REST, Routes } = require('discord.js');
const { clientID, guildId, token } = require('./config/config.js');
const fs = require('fs');
const path = require('path');

async function deployCommands() {
    const commands = [];

    const commandsPath = path.join(__dirname, 'commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        
        if ('data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
            console.log(`✅ Loaded command: ${command.data.name}`);
        } else {
            console.log(`❌ Command ${file} thiếu "data" hoặc "execute"`);
        }
    }

    const rest = new REST().setToken(token);

    try {
        console.log(`🚀 Bắt đầu deploy ${commands.length} slash commands...`);

        let route;
        console.log("guildid", guildId)
        if (guildId) {
            route = Routes.applicationGuildCommands(clientID, guildId);
            console.log('📍 Deploy cho guild:', guildId);
        } else {
            route = Routes.applicationCommands(clientID);
            console.log('🌍 Deploy global commands');
        }

        const data = await rest.put(route, { body: commands });

        console.log(`✅ Đã deploy ${data.length} slash commands thành công!`);
        console.log('\n📋 Danh sách commands:');
        data.forEach(cmd => {
            console.log(`   /${cmd.name} - ${cmd.description}`);
        });

    } catch (error) {
        console.error('❌ Lỗi khi deploy commands:', error);

        if (error.code === 50001) {
            console.log('💡 Bot thiếu quyền. Kiểm tra quyền và mời lại bot với scope applications.commands');
        } else if (error.code === 0) {
            console.log('💡 Kiểm tra .env: TOKEN, CLIENT_ID, GUILD_ID');
        }
    }
}

// ✅ Export chính xác hàm deploy
module.exports = {
    deployCommands
};
