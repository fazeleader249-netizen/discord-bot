const axios = require('axios');
const { geminiApiKey, geminiModel, geminiDailyLimit } = require('../config/config.js');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 15_000;

// Đếm số lần gọi trong ngày (giờ VN) để không vượt quota gói free
let usage = { day: null, count: 0 };

class GeminiError extends Error {
    constructor(userMessage) {
        super(userMessage);
        this.userMessage = userMessage;
    }
}

function todayVN() {
    return new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function takeQuota() {
    const day = todayVN();
    if (usage.day !== day) usage = { day, count: 0 };
    if (usage.count >= geminiDailyLimit) {
        throw new GeminiError('🥵 Hôm nay bot nói nhiều quá hết hơi rồi, mai quay lại nhé!');
    }
    usage.count++;
}

// Gọi Gemini 1 lần, trả về text. Lỗi nào cũng ném GeminiError có câu báo lỗi thân thiện
async function generateText(prompt, { systemInstruction, maxOutputTokens = 1024, temperature = 1 } = {}) {
    if (!geminiApiKey) {
        throw new GeminiError('❌ Bot chưa được cấu hình GEMINI_API_KEY.');
    }
    takeQuota();

    const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens, temperature }
    };
    if (systemInstruction) {
        body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    let data;
    try {
        const res = await axios.post(`${API_BASE}/${geminiModel}:generateContent`, body, {
            headers: { 'x-goog-api-key': geminiApiKey },
            timeout: TIMEOUT_MS
        });
        data = res.data;
    } catch (err) {
        const status = err.response?.status;
        console.error('Lỗi gọi Gemini:', status, err.response?.data?.error?.message || err.message);
        if (status === 429) {
            throw new GeminiError('🥵 AI đang quá tải hoặc hết lượt free, thử lại sau ít phút nhé!');
        }
        if (status === 400 || status === 403) {
            throw new GeminiError('❌ Cấu hình Gemini không hợp lệ (API key hoặc model), báo admin kiểm tra nhé.');
        }
        throw new GeminiError('❌ Không kết nối được tới AI, thử lại sau nhé.');
    }

    if (data.promptFeedback?.blockReason) {
        throw new GeminiError('🙊 Nội dung này AI không dám nói, đổi gợi ý khác nhé.');
    }

    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
        .filter(part => part.text && !part.thought)
        .map(part => part.text)
        .join('')
        .trim();

    if (!text) {
        if (candidate?.finishReason === 'SAFETY') {
            throw new GeminiError('🙊 Nội dung này AI không dám nói, đổi gợi ý khác nhé.');
        }
        console.error('Gemini trả về rỗng:', candidate?.finishReason);
        throw new GeminiError('🤐 AI im lặng không nói gì, thử lại nhé.');
    }

    return text;
}

module.exports = { generateText, GeminiError };
