const { Events } = require('discord.js');

module.exports = {
    name: Events.ClientReady,
    once: true,
    execute(client) {
        console.log(`✅ Bot đã sẵn sàng! Đăng nhập với tài khoản ${client.user.tag}`);
        
        // Đặt status cho bot
        client.user.setActivity('🎵 Soundboard Bot', { type: 'LISTENING' });
        console.log(`🟢 Bot đã đăng nhập thành công: ${client.user.tag}`);
        console.log(`📊 Đang phục vụ ${client.guilds.cache} server(s)`);
        console.log(`👤 Tổng cộng ${client.users.cache.size} user(s)`);
        console.log(`⏰ Thời gian khởi động: ${new Date().toLocaleString('vi-VN')}`);
        console.log('🔧 Sử dụng /test để kiểm tra bot hoạt động');
    },
};