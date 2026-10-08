const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');

// Thư mục chứa binary yt-dlp (tự tải về lần đầu)
const BIN_DIR = path.join(__dirname, '../bin');

const RELEASE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';

function getAssetName() {
    if (process.platform === 'win32') return 'yt-dlp.exe';
    if (process.platform === 'darwin') return 'yt-dlp_macos';
    return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
}

const LOCAL_BIN = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

let downloading = null;

// Đảm bảo có binary yt-dlp, trả về đường dẫn
async function ensureYtDlp() {
    if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
    if (fs.existsSync(LOCAL_BIN)) return LOCAL_BIN;
    if (downloading) return downloading;

    downloading = (async () => {
        fs.mkdirSync(BIN_DIR, { recursive: true });
        const tmpPath = `${LOCAL_BIN}.download`;
        console.log(`⏬ Đang tải yt-dlp (${getAssetName()})...`);

        const res = await axios.get(RELEASE_URL + getAssetName(), {
            responseType: 'stream',
            maxRedirects: 10,
            timeout: 120000
        });
        await new Promise((resolve, reject) => {
            const out = fs.createWriteStream(tmpPath);
            res.data.pipe(out);
            out.on('finish', resolve);
            out.on('error', reject);
            res.data.on('error', reject);
        });

        fs.renameSync(tmpPath, LOCAL_BIN);
        if (process.platform !== 'win32') fs.chmodSync(LOCAL_BIN, 0o755);
        console.log(`✅ Đã tải yt-dlp: ${LOCAL_BIN}`);
        return LOCAL_BIN;
    })();

    try {
        return await downloading;
    } finally {
        downloading = null;
    }
}

// Tham số chung: dùng Node hiện tại làm JS runtime cho YouTube, cookies nếu có
function commonArgs() {
    const args = ['--no-warnings', '--js-runtimes', `node:${process.execPath}`];
    if (process.env.YTDLP_COOKIES && fs.existsSync(process.env.YTDLP_COOKIES)) {
        args.push('--cookies', process.env.YTDLP_COOKIES);
    }
    return args;
}

function runYtDlp(args, timeoutMs = 30000) {
    return ensureYtDlp().then(bin => new Promise((resolve, reject) => {
        const proc = spawn(bin, [...commonArgs(), ...args], { windowsHide: true });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            proc.kill('SIGKILL');
            reject(new Error('yt-dlp quá thời gian phản hồi'));
        }, timeoutMs);

        proc.stdout.on('data', d => { stdout += d; });
        proc.stderr.on('data', d => { stderr += d; });
        proc.on('error', err => {
            clearTimeout(timer);
            reject(err);
        });
        proc.on('close', code => {
            clearTimeout(timer);
            if (code === 0) resolve(stdout);
            else reject(new Error(stderr.trim() || `yt-dlp exit code ${code}`));
        });
    }));
}

// Tìm video trên YouTube, trả về [{ id, title, duration, url, channel }]
async function searchYouTube(query, limit = 5) {
    const stdout = await runYtDlp([
        '--dump-json',
        '--flat-playlist',
        `ytsearch${limit}:${query}`
    ]);

    return stdout
        .split('\n')
        .filter(Boolean)
        .map(line => {
            try {
                const v = JSON.parse(line);
                return {
                    id: v.id,
                    title: v.title,
                    duration: v.duration || 0,
                    url: v.url || `https://www.youtube.com/watch?v=${v.id}`,
                    channel: v.channel || v.uploader || ''
                };
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

// Lấy thông tin 1 video từ link
async function getVideoInfo(url) {
    const stdout = await runYtDlp(['--dump-json', '--no-playlist', '--skip-download', url]);
    const v = JSON.parse(stdout);
    return {
        id: v.id,
        title: v.title,
        duration: v.duration || 0,
        url: v.webpage_url || url,
        channel: v.channel || v.uploader || ''
    };
}

// Spawn yt-dlp xuất audio ra stdout
async function spawnAudioStream(url) {
    const bin = await ensureYtDlp();
    return spawn(bin, [
        ...commonArgs(),
        '-f', 'bestaudio/best',
        '--no-playlist',
        '--quiet',
        '-o', '-',
        url
    ], { windowsHide: true });
}

module.exports = {
    ensureYtDlp,
    searchYouTube,
    getVideoInfo,
    spawnAudioStream
};
