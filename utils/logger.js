const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this.logDir = path.join(__dirname, '..', 'logs');
        this.ensureLogDirectory();
    }
    
    ensureLogDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }
    
    log(level, message) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
        
        // Ghi vào console
        console.log(logMessage.trim());
        
        // Ghi vào file
        const logFile = path.join(this.logDir, `${new Date().toISOString().split('T')[0]}.log`);
        fs.appendFileSync(logFile, logMessage);
    }
    
    info(message) {
        this.log('info', message);
    }
    
    error(message) {
        this.log('error', message);
    }
    
    warn(message) {
        this.log('warn', message);
    }
}

module.exports = new Logger();