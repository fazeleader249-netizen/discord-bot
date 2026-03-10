const { deployCommands } = require("./deploy-commands");
const { runBot } = require("./index");
const http = require('http');

const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot Discord is running!');
});

function openPort() {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ HTTP server đã mở trên port ${PORT} - Bot đã sẵn sàng!`);
    });
}

// Khởi động bot trước, mở port sau khi bot ready (tối đa 20s)
(async () => {
    // Đặt timeout fallback: nếu bot chưa ready sau 20s thì vẫn mở port để Render không kill service
    const fallbackTimer = setTimeout(() => {
        console.log("⚠️ Timeout 20s — Mở port dù bot chưa kết nối xong.");
        openPort();
    }, 60000);

    // 1. Đăng ký slash commands (không block)
    deployCommands().catch(error => {
        console.error("❌ Lỗi khi đăng ký lệnh:", error);
    });

    // 2. Chạy Bot Discord — mở port ngay khi login xong
    try {
        console.log("🚀 Đang khởi động kết nối Discord...");
        await runBot(() => {
            clearTimeout(fallbackTimer); // Hủy fallback vì bot đã ready
            console.log("✅ Bot đã kết nối Discord! Đang mở port...");
            openPort();
        });
    } catch (error) {
        console.error("❌ Lỗi nghiêm trọng khi chạy bot:", error);
        clearTimeout(fallbackTimer);
        openPort(); // Vẫn mở port để Render không kill service
    }
})();