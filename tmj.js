Berikut adalah pembaruan lengkap untuk Backend Server (index.js) dan Frontend
Web Control (index.html).

🌟 Ringkasan Pembaruan & Fitur Baru:

1.  Custom Owner & Nama Owner Per-Bot:
      - Setiap bot dapat memiliki nomor Owner dan Nama Owner khusus sendiri
        (misalnya: Bot A milik "Zack", Bot B milik "Mas Alex").
      - AI akan memanggil nama owner sesuai settingan spesifik bot tersebut.
2.  Pengaturan Auto-Read & Rutinitas Harian Khusus Per-Bot:
      - Fitur Auto Read dan Notifikasi Rutinitas harian kini bisa
        dihidupkan/dimatikan spesifik per bot.
3.  Upload & Restore Backup Data (.ZIP):
      - Fitur baru untuk mengunggah file .zip backup (yang berisi Database dan
        sessions). File akan otomatis diekstrak dan memulihkan seluruh data
        chat, memori, serta sesi WhatsApp sebelumnya secara instan.
4.  AI Self-Learning & Pembelajaran Percakapan:
      - AI memanfaatkan riwayat pesan terdahulu untuk "mengingat" dan
        mempelajari topik, kebiasaan, serta gaya interaksi user agar respon
        semakin alami, akrab, dan manusiawi.
5.  Penyesuaian Karakter AI (Aisyah AI):
      - Bukan Cuek Lagi: AI untuk user umum diubah menjadi ramah, hangat,
        netral, dan akrab seperti manusia biasa.
      - Identitas Aisyah AI: Jika user menanyakan "kamu siapa?", "siapa
        namamu?", atau sejenisnya, AI akan menjawab secara ramah bahwa namanya
        adalah Aisyah AI.

1. File Backend Server API (index.js)

Gantikan seluruh file index.js Anda dengan kode berikut:

const dns = require('dns');
try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {}

const fs = require('fs');
const path = require('path');
const express = require('express');
const pino = require('pino');
const axios = require('axios');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { Boom } = require('@hapi/boom');
const { parsePhoneNumber } = require('awesome-phonenumber');
const { 
    default: WAConnection, 
    useMultiFileAuthState, 
    Browsers, 
    DisconnectReason, 
    makeCacheableSignalKeyStore, 
    fetchLatestWaWebVersion 
} = require('baileys');

// Nomor Utama Zack Default
const ZACK_NUMBER = '6283110390167@s.whatsapp.net';

const app = express();
const PORT = process.env.PORT || 3000;

// Setup Multer untuk Upload File, Session & Restore Backup
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({ dest: UPLOADS_DIR });

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ status: false, message: 'Format Body JSON tidak valid.' });
    }
    next();
});

const SESSIONS_DIR = path.join(__dirname, 'sessions');
const DB_DIR = path.join(__dirname, 'Database');
const CHATS_DIR = path.join(DB_DIR, 'chats');
const USERS_DIR = path.join(DB_DIR, 'users');
const FACTS_DIR = path.join(DB_DIR, 'facts');
const OWNER_FILE = path.join(DB_DIR, 'owner.json');
const BOT_CONFIGS_FILE = path.join(DB_DIR, 'bot_configs.json');

const sessions = new Map();
const msgRetryCounterCache = new Map();

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(CHATS_DIR)) fs.mkdirSync(CHATS_DIR, { recursive: true });
if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true });
if (!fs.existsSync(FACTS_DIR)) fs.mkdirSync(FACTS_DIR, { recursive: true });

if (!fs.existsSync(OWNER_FILE)) {
    fs.writeFileSync(OWNER_FILE, JSON.stringify([getCleanJid(ZACK_NUMBER)], null, 2));
}

if (!fs.existsSync(BOT_CONFIGS_FILE)) {
    fs.writeFileSync(BOT_CONFIGS_FILE, JSON.stringify({}, null, 2));
}

const routineTypes = [
    { time: '05:00', id: 'bangun_pagi_dan_olahraga' },
    { time: '07:00', id: 'sarapan_pagi' },
    { time: '12:00', id: 'makan_siang' },
    { time: '16:00', id: 'olahraga_sore' },
    { time: '18:30', id: 'makan_malam' },
    { time: '22:00', id: 'tidur_malam' }
];

// Pembersih JID / Nomor HP
function getCleanJid(jid) {
    if (!jid) return '';
    return String(jid).split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

// Manajemen Konfigurasi Spesifik Per Bot
function getAllBotConfigs() {
    try {
        if (!fs.existsSync(BOT_CONFIGS_FILE)) return {};
        return JSON.parse(fs.readFileSync(BOT_CONFIGS_FILE, 'utf-8'));
    } catch (e) {
        return {};
    }
}

function getBotConfig(botNumber) {
    const cleanBot = getCleanJid(botNumber);
    const configs = getAllBotConfigs();
    return configs[cleanBot] || {
        ownerNumber: getCleanJid(ZACK_NUMBER),
        ownerName: 'Zack',
        autoRead: false,
        routineEnabled: true
    };
}

function saveBotConfig(botNumber, newConfig) {
    const cleanBot = getCleanJid(botNumber);
    const configs = getAllBotConfigs();
    configs[cleanBot] = {
        ...getBotConfig(botNumber),
        ...newConfig
    };
    fs.writeFileSync(BOT_CONFIGS_FILE, JSON.stringify(configs, null, 2), 'utf-8');
}

// Ambil daftar nomor Owner Global
function getGlobalOwnerList() {
    let list = [getCleanJid(ZACK_NUMBER)];
    if (fs.existsSync(OWNER_FILE)) {
        try {
            const saved = JSON.parse(fs.readFileSync(OWNER_FILE, 'utf-8'));
            if (Array.isArray(saved)) {
                list = list.concat(saved.map(getCleanJid));
            }
        } catch (e) {}
    }
    return [...new Set(list.filter(Boolean))];
}

// Pengecekan Owner Per-Bot
function isZackUser(userJid, msgOrName = null, botNumber = null) {
    const globalOwners = getGlobalOwnerList();
    let botOwner = null;

    if (botNumber) {
        const cfg = getBotConfig(botNumber);
        if (cfg.ownerNumber) botOwner = getCleanJid(cfg.ownerNumber);
    }

    let candidates = [userJid];
    let pushName = '';

    if (msgOrName && typeof msgOrName === 'object') {
        candidates.push(
            msgOrName.key?.remoteJid,
            msgOrName.key?.remoteJidAlt,
            msgOrName.key?.participant,
            msgOrName.key?.participantAlt,
            msgOrName.sender,
            msgOrName.participant
        );
        pushName = msgOrName.pushName || msgOrName.verifiedBizName || '';
    } else if (typeof msgOrName === 'string') {
        pushName = msgOrName;
    }

    const cleanCandidates = candidates.filter(Boolean).map(getCleanJid);

    // Cek terhadap owner spesifik bot ini ATAU owner global
    const matchNumber = cleanCandidates.some(num => num && (globalOwners.includes(num) || (botOwner && num === botOwner)));
    if (matchNumber) return true;

    if (pushName && pushName.toLowerCase().includes('zack')) {
        return true;
    }

    return false;
}

function saveUserChatMessage(botNumber, userJid, userName, role, content, isZack = false) {
    const cleanNum = getCleanJid(userJid);
    const filePath = path.join(CHATS_DIR, `${botNumber}_${cleanNum}.json`);
    let list = [];

    if (fs.existsSync(filePath)) {
        try {
            list = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch (e) {
            list = [];
        }
    }

    list.push({
        id: Date.now().toString(),
        botNumber,
        userJid,
        userName,
        isZack,
        role,
        content,
        timestamp: new Date()
    });

    if (list.length > 50) list.shift();

    fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf-8');
}

function getUserChats(botNumber, userJid, limit = 50) {
    const cleanNum = getCleanJid(userJid);
    const filePath = path.join(CHATS_DIR, `${botNumber}_${cleanNum}.json`);
    if (!fs.existsSync(filePath)) return [];

    try {
        const list = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return list.slice(-limit);
    } catch (e) {
        return [];
    }
}

function getAllRecentLogs(limit = 50) {
    const all = [];
    if (!fs.existsSync(CHATS_DIR)) return all;

    const files = fs.readdirSync(CHATS_DIR);
    for (const file of files) {
        if (file.endsWith('.json')) {
            try {
                const list = JSON.parse(fs.readFileSync(path.join(CHATS_DIR, file), 'utf-8'));
                all.push(...list);
            } catch (e) {}
        }
    }

    all.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return all.slice(0, limit);
}

function saveUserProfile(userJid, pushName, isZack) {
    const cleanNum = getCleanJid(userJid);
    const filePath = path.join(USERS_DIR, `${cleanNum}.json`);
    const data = {
        jid: userJid,
        pushName,
        isZack,
        lastSeen: new Date()
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function getAllContacts() {
    const contacts = [];
    if (!fs.existsSync(USERS_DIR)) return contacts;

    const files = fs.readdirSync(USERS_DIR);
    for (const file of files) {
        if (file.endsWith('.json')) {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(USERS_DIR, file), 'utf-8'));
                contacts.push(data);
            } catch (e) {}
        }
    }

    contacts.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
    return contacts;
}

function saveFact(factKey, factValue) {
    const filePath = path.join(FACTS_DIR, 'facts.json');
    let facts = {};

    if (fs.existsSync(filePath)) {
        try {
            facts = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch (e) {
            facts = {};
        }
    }

    facts[factKey] = {
        factKey,
        factValue,
        createdAt: new Date()
    };

    fs.writeFileSync(filePath, JSON.stringify(facts, null, 2), 'utf-8');
}

function getFacts() {
    const filePath = path.join(FACTS_DIR, 'facts.json');
    if (!fs.existsSync(filePath)) return {};

    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
        return {};
    }
}

async function callAI(messages) {
    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const userMsgs = messages.filter(m => m.role !== 'system');
    
    let conversationText = userMsgs.map(m => `${m.role === 'user' ? 'User' : 'Aisyah AI'}: ${m.content}`).join('\n');

    const promptParam = encodeURIComponent(conversationText);
    const systemParam = encodeURIComponent(systemMsg);

    try {
        const url1 = `https://api.siputzx.my.id/api/ai/gptoss120b?prompt=${promptParam}&system=${systemParam}&temperature=0.7`;
        const res1 = await axios.get(url1, { timeout: 12000 });
        if (res1.data && res1.data.status && res1.data.data && res1.data.data.response) {
            return res1.data.data.response.trim();
        }
    } catch (e) {}

    try {
        const url2 = `https://api.siputzx.my.id/api/ai/glm47flash?prompt=${promptParam}&system=${systemParam}&temperature=0.7`;
        const res2 = await axios.get(url2, { timeout: 12000 });
        if (res2.data && res2.data.status && res2.data.data && res2.data.data.response) {
            return res2.data.data.response.trim();
        }
    } catch (e) {}

    return null;
}

async function generateAIRoutineMessage(routineId, ownerName = 'Zack') {
    const factsObj = getFacts();
    let memoryContext = Object.values(factsObj).map(f => `${f.factKey}: ${f.factValue}`).join(', ');

    const systemPrompt = `Kamu adalah pacar cewek dari ${ownerName}. Kamu sangat mencintai ${ownerName}.
Tugasmu: Buatkan pesan pengingat '${routineId}' untuk ${ownerName}.
Konteks Fakta ${ownerName}: ${memoryContext || 'Tidak ada'}
Aturan:
- Gunakan bahasa Indonesia santai, sangat manis, perhatian, dan kreatif.
- Panggil dia dengan '${ownerName} sayang' atau 'Sayang'.
- Sertakan kalimat bervariasi, romantis, dan perhatian (2-3 kalimat).
- Jangan kaku dan buat ucapan yang berbeda setiap kali dimintai.`;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Ingatkan ${ownerName} tentang ${routineId} sekarang secara manis!` }
    ];

    const aiMsg = await callAI(messages);
    return aiMsg || `${ownerName} sayang, udah waktunya ${routineId.replace(/_/g, ' ')} nih! Jangan lupa ya manis, I love you!`;
}

// PERBAIKAN AI: Self-Learning dari riwayat percakapan + Karakter Netral Aisyah AI
async function getAIResponseWithHistory(botNumber, userJid, userName, userMessage, isZack) {
    const recentChats = getUserChats(botNumber, userJid, 15); // Ambil 15 riwayat terakhir untuk self-learning
    const botConfig = getBotConfig(botNumber);
    const ownerName = botConfig.ownerName || 'Zack';

    let systemPrompt = '';
    if (isZack) {
        const factsObj = getFacts();
        let memoryText = Object.values(factsObj).map(f => `${f.factKey}: ${f.factValue}`).join(', ');

        systemPrompt = `Kamu adalah Aisyah, pacar cewek penyayang dari ${ownerName}.
Gaya bicara: Sangat manis, perhatian, manja, hangat, dan penyayang. Panggil dia '${ownerName}', 'Sayang', atau 'Mas ${ownerName}'.
Gunakan ekspresi santai ("muach", "hehe", "iya sayang").
Fakta Memori tentang ${ownerName}: ${memoryText || 'Belum ada memori terdaftar'}.
Aturan Self-Learning: Pelajari topik dan gaya obrolan dari riwayat chat sebelumnya agar jawabanmu makin akrab dan natural.
Aturan Identitas: Jika ditanya siapa namamu, jawab namamu Aisyah pacar manisnya ${ownerName}.`;
    } else {
        systemPrompt = `Kamu adalah Aisyah AI, asisten kecerdasan buatan ramah yang sedang berbicara dengan ${userName}.
Gaya bicara: Netral, hangat, ramah, alami, dan sopan seperti manusia biasa.
Aturan Penting Identitas:
- Jika ditanya 'kamu siapa?', 'siapa namamu?', 'siapa ini?', atau pertanyaan identitas lainnya, JAWAB DENGAN JELAS DAN RAMAH BAHWA NAMAMU ADALAH "Aisyah AI".
- JANGAN CUEK DAN JANGAN DINGIN. Bersikaplah friendly, membantu, dan bangun hubungan obrolan yang akrab dan manusiawi.
Aturan Self-Learning: Gunakan konteks dari riwayat pesan sebelumnya untuk memberikan jawaban yang makin pas, akurat, dan nyambung dengan obrolan user.`;
    }

    const messages = [{ role: 'system', content: systemPrompt }];

    // Pembelajaran Otomatis dari Riwayat Chat Terakhir
    for (const chat of recentChats) {
        messages.push({
            role: chat.role === 'user' ? 'user' : 'assistant',
            content: chat.content
        });
    }

    messages.push({ role: 'user', content: userMessage });

    const reply = await callAI(messages);
    if (reply) return reply;

    return isZack 
        ? `${ownerName} sayang, bentar ya manis, jaringan aku lagi agak lelet nih tapi aku tetep sayang kamu!` 
        : `Halo ${userName}! Maaf ya jaringan Aisyah AI lagi agak lelet, ada yang bisa Aisyah bantu?`;
}

// Handler Pesan Masuk
async function handleIncomingMessage(botNumber, sock, msg) {
    try {
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJidAlt || msg.key.remoteJid;
        if (!from || from.endsWith('@g.us') || from === 'status@broadcast') return;

        const botConfig = getBotConfig(botNumber);

        // AutoRead Spesifik Per Bot
        if (botConfig.autoRead) {
            try { await sock.readMessages([msg.key]); } catch (e) {}
        }

        const pushname = msg.pushName || msg.verifiedBizName || "No Name";
        const text = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || 
                     msg.message.imageMessage?.caption || 
                     msg.message.videoMessage?.caption || '';

        if (!text.trim()) return;

        const isZack = isZackUser(from, msg, botNumber);

        saveUserProfile(from, pushname, isZack);
        saveUserChatMessage(botNumber, from, pushname, 'user', text, isZack);

        await sock.sendPresenceUpdate('composing', from);
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const aiReply = await getAIResponseWithHistory(botNumber, from, pushname, text, isZack);

        await sock.sendPresenceUpdate('paused', from);
        saveUserChatMessage(botNumber, from, pushname, 'assistant', aiReply, isZack);

        await sock.sendMessage(from, { text: aiReply }, { quoted: msg });
    } catch (err) {
        console.error('[ERROR MESSAGE HANDLER]', err.message);
    }
}

async function createSession(number) {
    return new Promise(async (resolve, reject) => {
        const sessionPath = path.join(SESSIONS_DIR, number);
        const level = pino({ level: 'silent' });
        const { version } = await fetchLatestWaWebVersion();

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

        const getMessage = async (key) => {
            const list = getUserChats(number, key.remoteJid, 20);
            const found = list.find(m => m.id === key.id);
            if (found) {
                return { conversation: found.content };
            }
            return { conversation: '' };
        };

        const sock = WAConnection({
            version,
            logger: level,
            syncFullHistory: false,
            maxMsgRetryCount: 15,
            msgRetryCounterCache,
            getMessage,
            retryRequestDelayMs: 10,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            browser: Browsers.ubuntu('Chrome'),
            generateHighQualityLinkPreview: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, level),
            },
        });

        const botConfig = getBotConfig(number);
        const formattedTargetNumber = getCleanJid(botConfig.ownerNumber || ZACK_NUMBER);
        const targetJid = formattedTargetNumber + '@s.whatsapp.net';

        const sessionData = {
            number,
            targetJid,
            sock,
            status: 'connecting',
            createdAt: new Date()
        };

        sessions.set(number, sessionData);

        sock.ev.on('creds.update', saveCreds);

        let codeResolved = false;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if ((connection === 'connecting' || !!qr) && !sock.authState.creds.registered && !codeResolved) {
                codeResolved = true;
                setTimeout(async () => {
                    try {
                        let code = await sock.requestPairingCode(number);
                        code = code?.match(/.{1,4}/g)?.join('-') || code;
                        resolve(code);
                    } catch (err) {
                        reject(err);
                    }
                }, 3000);
            }

            if (connection === 'close') {
                const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
                sessionData.status = 'disconnected';

                if (reason === DisconnectReason.badSession || reason === DisconnectReason.loggedOut) {
                    console.log(`[INFO] Sesi ${number} kadaluwarsa atau keluar. Menghapus folder sesi...`);
                    sessions.delete(number);
                    if (fs.existsSync(sessionPath)) {
                        fs.rmSync(sessionPath, { recursive: true, force: true });
                    }
                } else if (
                    reason === DisconnectReason.connectionLost ||
                    reason === DisconnectReason.connectionClosed ||
                    reason === DisconnectReason.timedOut ||
                    reason === DisconnectReason.restartRequired ||
                    reason === 515
                ) {
                    if (sock.authState.creds.registered) {
                        console.log(`[INFO] Memulihkan koneksi bot ${number}...`);
                        setTimeout(() => createSession(number), 3000);
                    }
                }
            }

            if (connection === 'open') {
                sessionData.status = 'connected';
                console.log(`[STATUS] Bot ${number} terhubung ke WhatsApp.`);
                if (!codeResolved) resolve(null);
            }
        });

        sock.ev.on('messages.upsert', async (chat) => {
            if (chat.type === 'notify') {
                for (const msg of chat.messages) {
                    await handleIncomingMessage(number, sock, msg);
                }
            }
        });
    });
}

let lastSentRoutines = {};
setInterval(async () => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':');
    const todayStr = now.toISOString().split('T')[0];

    const routine = routineTypes.find(r => r.time === timeStr);
    if (routine) {
        const key = `${todayStr}_${routine.id}`;
        if (!lastSentRoutines[key]) {
            lastSentRoutines[key] = true;

            for (const [number, session] of sessions.entries()) {
                const config = getBotConfig(number);
                // Hanya kirim jika Notifikasi Rutinitas diaktifkan untuk bot ini
                if (config.routineEnabled !== false && session.status === 'connected' && session.sock) {
                    try {
                        const dynamicMessage = await generateAIRoutineMessage(routine.id, config.ownerName || 'Zack');
                        await session.sock.sendMessage(session.targetJid, { text: dynamicMessage });
                        console.log(`[RUTINITAS AI] Terkirim '${routine.id}' dari bot ${number} ke ${config.ownerName}.`);
                    } catch (err) {
                        console.error(`[RUTINITAS ERROR] Gagal mengirim:`, err.message);
                    }
                }
            }
        }
    }
}, 20000);

async function loadSavedSessions() {
    if (!fs.existsSync(SESSIONS_DIR)) return;
    const folders = fs.readdirSync(SESSIONS_DIR);
    for (const folder of folders) {
        const sessionPath = path.join(SESSIONS_DIR, folder);
        if (fs.existsSync(path.join(sessionPath, 'creds.json'))) {
            console.log(`[STARTUP] Memuat ulang sesi bot: ${folder}`);
            createSession(folder).catch((err) => {
                console.error(`[STARTUP ERROR] Gagal memuat bot ${folder}:`, err.message);
            });
        }
    }
}

app.get('/', (req, res) => {
    const htmlPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(htmlPath)) {
        res.sendFile(htmlPath);
    } else {
        res.send('Server API Berjalan. File index.html tidak ditemukan.');
    }
});

// ---------------- API ENDPOINTS REVISI & RESTORE BACKUP ----------------

// API Get & Save Konfigurasi Khusus Per-Bot
app.get('/api/bot-config/:number', (req, res) => {
    const number = getCleanJid(req.params.number);
    res.json({ status: true, config: getBotConfig(number) });
});

app.post('/api/bot-config', (req, res) => {
    const { number, ownerNumber, ownerName, autoRead, routineEnabled } = req.body;
    if (!number) return res.status(400).json({ status: false, message: 'Parameter number wajib diisi.' });

    const cleanNum = getCleanJid(number);
    saveBotConfig(cleanNum, {
        ownerNumber: ownerNumber ? getCleanJid(ownerNumber) : getBotConfig(cleanNum).ownerNumber,
        ownerName: ownerName || getBotConfig(cleanNum).ownerName,
        autoRead: autoRead !== undefined ? Boolean(autoRead) : getBotConfig(cleanNum).autoRead,
        routineEnabled: routineEnabled !== undefined ? Boolean(routineEnabled) : getBotConfig(cleanNum).routineEnabled
    });

    // Update targetJid di memori jika owner berubah
    if (sessions.has(cleanNum)) {
        const sess = sessions.get(cleanNum);
        sess.targetJid = getCleanJid(ownerNumber || getBotConfig(cleanNum).ownerNumber) + '@s.whatsapp.net';
    }

    res.json({ status: true, message: `Pengaturan khusus untuk bot ${cleanNum} berhasil disimpan!` });
});

// FITUR BARU: UPLOAD & RESTORE BACKUP .ZIP DATA (Database & Sessions)
app.post('/api/restore-backup', upload.single('backupZip'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: false, message: 'Pilih file backup .zip yang akan di-restore.' });
    }

    try {
        const zip = new AdmZip(req.file.path);
        
        // Ekstrak file zip langsung menimpa folder proyek
        zip.extractAllTo(__dirname, true);

        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        // Muat ulang sesi yang ada dari backup
        await loadSavedSessions();

        return res.json({ status: true, message: 'Restore backup berhasil! Seluruh data & sesi bot telah dipulihkan.' });
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(500).json({ status: false, message: 'Gagal merestore backup: ' + err.message });
    }
});

// API Download FULL Backup (.ZIP Database + Folder Sessions)
app.get('/api/backup-db', async (req, res) => {
    try {
        const zip = new AdmZip();
        if (fs.existsSync(DB_DIR)) zip.addLocalFolder(DB_DIR, 'Database');
        if (fs.existsSync(SESSIONS_DIR)) zip.addLocalFolder(SESSIONS_DIR, 'sessions');

        const zipBuffer = zip.toBuffer();
        const dateStr = new Date().toISOString().split('T')[0];
        const filename = `Backup_Full_Zack_Bot_${dateStr}.zip`;

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(zipBuffer);
    } catch (err) {
        res.status(500).json({ status: false, message: 'Gagal membuat full backup: ' + err.message });
    }
});

// API Download Single Session Per Bot (.ZIP)
app.get('/api/bot/download-session/:number', async (req, res) => {
    const cleanNum = getCleanJid(req.params.number);
    const sessionPath = path.join(SESSIONS_DIR, cleanNum);

    if (!fs.existsSync(sessionPath)) {
        return res.status(404).json({ status: false, message: `Folder sesi bot ${cleanNum} tidak ditemukan.` });
    }

    try {
        const zip = new AdmZip();
        zip.addLocalFolder(sessionPath);
        const zipBuffer = zip.toBuffer();
        const filename = `Session_Bot_${cleanNum}.zip`;

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(zipBuffer);
    } catch (err) {
        res.status(500).json({ status: false, message: 'Gagal mengunduh sesi: ' + err.message });
    }
});

// API Send Media (Direct File Upload via Multer ATAU URL)
app.post('/api/send-media', upload.single('mediaFile'), async (req, res) => {
    const { number, targetJid, type, caption, fileName, ptt, mediaUrl } = req.body;

    if (!number || !targetJid || !type) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ status: false, message: 'Parameter number, targetJid, dan type wajib diisi.' });
    }

    const cleanNum = getCleanJid(number);
    const session = sessions.get(cleanNum);

    if (!session || session.status !== 'connected') {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(404).json({ status: false, message: `Bot ${cleanNum} tidak terhubung.` });
    }

    try {
        const formattedJid = targetJid.includes('@') ? targetJid : getCleanJid(targetJid) + '@s.whatsapp.net';
        let mediaSource = null;

        if (req.file) {
            mediaSource = { url: req.file.path };
        } else if (mediaUrl) {
            mediaSource = { url: mediaUrl };
        } else {
            return res.status(400).json({ status: false, message: 'Upload file media atau sertakan mediaUrl.' });
        }

        let mediaPayload = {};
        if (type === 'image') {
            mediaPayload = { image: mediaSource, caption: caption || '' };
        } else if (type === 'video') {
            mediaPayload = { video: mediaSource, caption: caption || '' };
        } else if (type === 'audio') {
            mediaPayload = { audio: mediaSource, mimetype: 'audio/mp4', ptt: ptt === 'true' || ptt === true };
        } else if (type === 'document') {
            mediaPayload = { document: mediaSource, mimetype: req.file?.mimetype || 'application/pdf', fileName: fileName || req.file?.originalname || 'document.pdf', caption: caption || '' };
        } else {
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({ status: false, message: 'Tipe media tidak valid. Pilih: image, video, audio, atau document.' });
        }

        await session.sock.sendMessage(formattedJid, mediaPayload);

        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        const isTargetZack = isZackUser(formattedJid, null, cleanNum);
        saveUserChatMessage(cleanNum, formattedJid, 'API Admin', 'assistant', `[MEDIA: ${type.toUpperCase()}] ${caption || ''}`, isTargetZack);

        return res.json({ status: true, message: `Media ${type} berhasil dikirim!` });
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(500).json({ status: false, message: 'Gagal mengirim media: ' + err.message });
    }
});

// API Broadcast Pesan ke Semua Kontak
app.post('/api/broadcast', async (req, res) => {
    const { number, message } = req.body;
    if (!number || !message) return res.status(400).json({ status: false, message: 'Parameter number dan message wajib diisi.' });

    const cleanNum = getCleanJid(number);
    const session = sessions.get(cleanNum);

    if (!session || session.status !== 'connected') {
        return res.status(404).json({ status: false, message: `Bot ${cleanNum} tidak terhubung.` });
    }

    const contacts = getAllContacts();
    let sentCount = 0;

    for (const c of contacts) {
        try {
            await session.sock.sendMessage(c.jid, { text: message });
            sentCount++;
            await new Promise(r => setTimeout(r, 1500));
        } catch (e) {}
    }

    return res.json({ status: true, message: `Broadcast berhasil terkirim ke ${sentCount} kontak!` });
});

app.get('/api/facts', (req, res) => {
    res.json({ status: true, facts: Object.values(getFacts()) });
});

app.delete('/api/facts/:key', (req, res) => {
    const key = req.params.key;
    const filePath = path.join(FACTS_DIR, 'facts.json');
    let facts = getFacts();
    if (facts[key]) {
        delete facts[key];
        fs.writeFileSync(filePath, JSON.stringify(facts, null, 2), 'utf-8');
        return res.json({ status: true, message: `Fakta '${key}' berhasil dihapus.` });
    }
    return res.status(404).json({ status: false, message: 'Fakta tidak ditemukan.' });
});

app.delete('/api/chats', (req, res) => {
    const { botNumber, userJid } = req.query;
    if (!botNumber || !userJid) return res.status(400).json({ status: false, message: 'Parameter botNumber dan userJid wajib diisi.' });

    const cleanBot = getCleanJid(botNumber);
    const cleanUser = getCleanJid(userJid);
    const filePath = path.join(CHATS_DIR, `${cleanBot}_${cleanUser}.json`);

    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return res.json({ status: true, message: 'Riwayat chat berhasil dihapus.' });
    }
    return res.status(404).json({ status: false, message: 'File riwayat chat tidak ditemukan.' });
});

app.get('/api/chats/conversations', async (req, res) => {
    try {
        if (!fs.existsSync(CHATS_DIR)) return res.json({ status: true, conversations: [] });

        const files = fs.readdirSync(CHATS_DIR);
        const conversations = [];

        for (const file of files) {
            if (file.endsWith('.json')) {
                try {
                    const filePath = path.join(CHATS_DIR, file);
                    const list = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                    if (list.length > 0) {
                        const lastMsg = list[list.length - 1];
                        const parts = file.replace('.json', '').split('_');
                        const botNumber = parts[0];
                        const cleanNum = parts[1] || '';

                        conversations.push({
                            file,
                            botNumber,
                            userJid: lastMsg.userJid,
                            cleanNum,
                            userName: lastMsg.userName || 'No Name',
                            isZack: isZackUser(lastMsg.userJid, lastMsg.userName, botNumber),
                            lastContent: lastMsg.content,
                            lastTimestamp: lastMsg.timestamp,
                            totalMessages: list.length
                        });
                    }
                } catch (e) {}
            }
        }

        conversations.sort((a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp));
        return res.json({ status: true, total: conversations.length, conversations });
    } catch (err) {
        return res.status(500).json({ status: false, message: 'Gagal memuat percakapan: ' + err.message });
    }
});

app.get('/api/db-status', async (req, res) => {
    try {
        const usersCount = fs.existsSync(USERS_DIR) ? fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json')).length : 0;
        const chatsCount = fs.existsSync(CHATS_DIR) ? fs.readdirSync(CHATS_DIR).filter(f => f.endsWith('.json')).length : 0;
        const factsObj = getFacts();
        const factsCount = Object.keys(factsObj).length;
        const ownersCount = getGlobalOwnerList().length;

        res.json({
            status: true,
            stats: {
                totalUsers: usersCount,
                totalChatFiles: chatsCount,
                totalFacts: factsCount,
                totalOwners: ownersCount
            }
        });
    } catch (err) {
        res.status(500).json({ status: false, message: err.message });
    }
});

app.get('/api/owner', (req, res) => {
    res.json({ status: true, owners: getGlobalOwnerList() });
});

app.post('/api/owner', (req, res) => {
    const { number } = req.body;
    if (!number) return res.status(400).json({ status: false, message: 'Parameter number wajib diisi.' });

    const clean = getCleanJid(number);
    let owners = getGlobalOwnerList();

    if (!owners.includes(clean)) {
        owners.push(clean);
        fs.writeFileSync(OWNER_FILE, JSON.stringify(owners, null, 2));
        return res.json({ status: true, message: `Nomor ${clean} berhasil ditambahkan sebagai Owner!` });
    }
    res.json({ status: false, message: 'Nomor sudah terdaftar sebagai Owner.' });
});

app.delete('/api/owner/:number', (req, res) => {
    const clean = getCleanJid(req.params.number);
    let owners = getGlobalOwnerList().filter(num => num !== clean);
    fs.writeFileSync(OWNER_FILE, JSON.stringify(owners, null, 2));
    res.json({ status: true, message: `Nomor ${clean} berhasil dihapus dari daftar Owner.` });
});

app.all('/api/test-ai', async (req, res) => {
    const message = req.query.message || req.body?.message || "Halo, kamu siapa?";
    const isZack = req.query.isZack !== undefined ? req.query.isZack === 'true' : (req.body?.isZack !== undefined ? req.body.isZack : false);
    const userName = req.query.name || req.body?.name || "User";

    try {
        const aiReply = await getAIResponseWithHistory("test_bot", "6281234567890@s.whatsapp.net", userName, message, isZack);
        return res.json({
            status: true,
            inputMessage: message,
            isZack: isZack,
            userName: userName,
            aiResponse: aiReply
        });
    } catch (err) {
        return res.status(500).json({ status: false, error: err.message });
    }
});

app.get('/api/pairing', async (req, res) => {
    let number = req.query.number;

    if (!number) {
        return res.status(400).json({ status: false, message: 'Parameter ?number= wajib diisi.' });
    }

    number = getCleanJid(number);
    if (!parsePhoneNumber('+' + number).valid || number.length < 6) {
        return res.status(400).json({ status: false, message: 'Format nomor telepon tidak valid.' });
    }

    const sessionPath = path.join(SESSIONS_DIR, number);

    if (sessions.has(number)) {
        const sess = sessions.get(number);
        if (sess.status === 'connected') {
            return res.json({ status: false, message: `Bot ${number} sudah terhubung.` });
        }
        try { sess.sock?.ws?.close(); } catch(e){}
        sessions.delete(number);
    }

    if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
    }

    try {
        const pairingCode = await createSession(number);
        return res.json({
            status: true,
            number: number,
            targetZackNumber: ZACK_NUMBER,
            pairingCode: pairingCode,
            message: 'Kode pairing berhasil dibuat.'
        });
    } catch (err) {
        return res.status(500).json({ status: false, message: 'Gagal membuat kode pairing: ' + err.message });
    }
});

app.post('/api/upload-session', upload.single('sessionZip'), async (req, res) => {
    const { number } = req.body;
    if (!number || !req.file) {
        return res.status(400).json({ status: false, message: 'Parameter number dan file sessionZip (.zip) wajib diisi.' });
    }

    const cleanNum = getCleanJid(number);
    const targetSessionDir = path.join(SESSIONS_DIR, cleanNum);

    try {
        if (sessions.has(cleanNum)) {
            const sess = sessions.get(cleanNum);
            try { sess.sock?.ws?.close(); } catch(e){}
            sessions.delete(cleanNum);
        }

        if (fs.existsSync(targetSessionDir)) {
            fs.rmSync(targetSessionDir, { recursive: true, force: true });
        }

        fs.mkdirSync(targetSessionDir, { recursive: true });

        const zip = new AdmZip(req.file.path);
        zip.extractAllTo(targetSessionDir, true);

        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        createSession(cleanNum).catch(err => console.error('[UPLOAD ERROR]', err.message));

        return res.json({
            status: true,
            number: cleanNum,
            message: `Sesi ZIP untuk bot ${cleanNum} berhasil diekstrak dan dijalankan.`
        });
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(500).json({ status: false, message: 'Gagal mengekstrak sesi ZIP: ' + err.message });
    }
});

app.get('/api/bots', async (req, res) => {
    const listBots = [];
    for (const [number, session] of sessions.entries()) {
        const cfg = getBotConfig(number);
        listBots.push({
            number: number,
            targetJid: session.targetJid,
            status: session.status,
            ownerName: cfg.ownerName || 'Zack',
            ownerNumber: cfg.ownerNumber || ZACK_NUMBER,
            createdAt: session.createdAt
        });
    }
    return res.json({
        status: true,
        totalActive: listBots.length,
        bots: listBots
    });
});

app.delete('/api/bot/:number', async (req, res) => {
    const number = getCleanJid(req.params.number);
    const sessionPath = path.join(SESSIONS_DIR, number);

    if (sessions.has(number)) {
        const sess = sessions.get(number);
        try { sess.sock?.ws?.close(); } catch(e){}
        sessions.delete(number);
    }

    if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        return res.json({ status: true, message: `Bot ${number} berhasil dihapus.` });
    } else {
        return res.status(404).json({ status: false, message: `Sesi bot ${number} tidak ditemukan.` });
    }
});

app.post('/api/profile', async (req, res) => {
    const { number, name, bio, imageUrl } = req.body;
    if (!number) return res.status(400).json({ status: false, message: 'Parameter number wajib diisi.' });

    const cleanNum = getCleanJid(number);
    const session = sessions.get(cleanNum);

    if (!session || session.status !== 'connected') {
        return res.status(404).json({ status: false, message: `Bot ${cleanNum} tidak terhubung.` });
    }

    try {
        if (name) {
            await session.sock.updateProfileName(name);
        }
        if (bio) {
            await session.sock.updateProfileStatus(bio);
        }
        if (imageUrl) {
            const jid = session.sock.user.id.split(':')[0] + '@s.whatsapp.net';
            await session.sock.updateProfilePicture(jid, { url: imageUrl });
        }
        return res.json({ status: true, message: `Profil bot ${cleanNum} berhasil diperbarui.` });
    } catch (err) {
        return res.status(500).json({ status: false, message: 'Gagal memperbarui profil: ' + err.message });
    }
});

app.post('/api/send-message', async (req, res) => {
    const { number, targetJid, message } = req.body;
    if (!number || !targetJid || !message) {
        return res.status(400).json({ status: false, message: 'Parameter number, targetJid, dan message wajib diisi.' });
    }

    const cleanNum = getCleanJid(number);
    const session = sessions.get(cleanNum);

    if (!session || session.status !== 'connected') {
        return res.status(404).json({ status: false, message: `Bot ${cleanNum} tidak terhubung.` });
    }

    try {
        const formattedJid = targetJid.includes('@') ? targetJid : getCleanJid(targetJid) + '@s.whatsapp.net';
        await session.sock.sendMessage(formattedJid, { text: message });

        const isTargetZack = isZackUser(formattedJid, null, cleanNum);
        saveUserChatMessage(cleanNum, formattedJid, 'API Admin', 'assistant', message, isTargetZack);

        return res.json({ status: true, message: 'Pesan berhasil terkirim.' });
    } catch (err) {
        return res.status(500).json({ status: false, message: 'Gagal mengirim pesan: ' + err.message });
    }
});

app.get('/api/contacts', async (req, res) => {
    try {
        const contacts = getAllContacts();
        return res.json({
            status: true,
            total: contacts.length,
            contacts: contacts.map(c => ({
                jid: c.jid,
                number: getCleanJid(c.jid),
                pushName: c.pushName,
                isZack: isZackUser(c.jid, c.pushName),
                lastSeen: c.lastSeen
            }))
        });
    } catch (err) {
        return res.status(500).json({ status: false, message: 'Gagal mengambil kontak: ' + err.message });
    }
});

app.get('/api/monitoring', async (req, res) => {
    try {
        const recentLogs = getAllRecentLogs(50);

        const activeSessions = [];
        for (const [number, session] of sessions.entries()) {
            activeSessions.push({
                number,
                status: session.status,
                targetJid: session.targetJid
            });
        }

        return res.json({
            status: true,
            totalActiveBots: activeSessions.length,
            activeBots: activeSessions,
            recentChatLogs: recentLogs.map(log => ({
                id: log.id,
                botNumber: log.botNumber,
                userJid: log.userJid,
                userName: log.userName,
                isZack: log.isZack !== undefined ? log.isZack : isZackUser(log.userJid, log.userName, log.botNumber),
                role: log.role,
                content: log.content,
                timestamp: log.timestamp
            }))
        });
    } catch (err) {
        return res.status(500).json({ status: false, message: 'Gagal mengambil monitoring: ' + err.message });
    }
});

app.get('/api/chats', async (req, res) => {
    const { botNumber, userJid } = req.query;
    try {
        if (!botNumber || !userJid) {
            return res.status(400).json({ status: false, message: 'Parameter botNumber dan userJid wajib diisi.' });
        }

        const cleanBotNum = getCleanJid(botNumber);
        const formattedJid = userJid.includes('@') ? userJid : getCleanJid(userJid) + '@s.whatsapp.net';

        const chats = getUserChats(cleanBotNum, formattedJid, 50);

        return res.json({
            status: true,
            total: chats.length,
            chats
        });
    } catch (err) {
        return res.status(500).json({ status: false, message: 'Gagal mengambil riwayat chat: ' + err.message });
    }
});

app.listen(PORT, async () => {
    console.log(`[SERVER] Server API berjalan di http://localhost:${PORT}`);
    await loadSavedSessions();
});

process.on('uncaughtException', (err) => console.error('[UNCAUGHT EXCEPTION]', err));
process.on('unhandledRejection', (err) => console.error('[UNHANDLED REJECTION]', err));

2. File Frontend Web Mobile Putih Clean (index.html)

Gantikan seluruh isi file index.html Anda dengan kode berikut:

<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Zack Bot Control</title>

    <!-- FontAwesome CDN untuk ikon -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">

    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            -webkit-tap-highlight-color: transparent;
        }

        body {
            background-color: #f8fafc;
            color: #0f172a;
            padding-bottom: 24px;
        }

        header {
            background: #ffffff;
            border-bottom: 1px solid #e2e8f0;
            padding: 12px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: sticky;
            top: 0;
            z-index: 100;
            box-shadow: 0 1px 3px rgba(0,0,0,0.03);
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .burger-btn {
            background: #f1f5f9;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            font-size: 1.1rem;
            color: #1e293b;
            cursor: pointer;
            width: 38px;
            height: 38px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
        }

        .burger-btn:active {
            transform: scale(0.92);
        }

        header h1 {
            font-size: 1.05rem;
            font-weight: 800;
            color: #0f172a;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        header h1 i {
            color: #2563eb;
        }

        .api-badge {
            font-size: 0.7rem;
            font-weight: 700;
            padding: 5px 12px;
            border-radius: 20px;
            background: #f0fdf4;
            border: 1px solid #bbf7d0;
            color: #16a34a;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .api-badge.offline {
            background: #fef2f2;
            border-color: #fecaca;
            color: #dc2626;
        }

        .pulse-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background-color: currentColor;
            animation: pulse 1.8s infinite;
        }

        @keyframes pulse {
            0% { opacity: 0.4; transform: scale(0.9); }
            50% { opacity: 1; transform: scale(1.1); }
            100% { opacity: 0.4; transform: scale(0.9); }
        }

        .drawer-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(15, 23, 42, 0.35);
            backdrop-filter: blur(2px);
            z-index: 200;
            display: none;
            opacity: 0;
            transition: opacity 0.25s ease;
        }

        .drawer-overlay.active {
            display: block;
            opacity: 1;
        }

        .drawer {
            position: fixed;
            top: 0;
            left: -270px;
            width: 270px;
            height: 100%;
            background: #ffffff;
            z-index: 201;
            transition: left 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            box-shadow: 4px 0 20px rgba(0,0,0,0.08);
            display: flex;
            flex-direction: column;
        }

        .drawer.active {
            left: 0;
        }

        .drawer-header {
            padding: 18px 20px;
            border-bottom: 1px solid #f1f5f9;
            font-size: 1rem;
            font-weight: 800;
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: #0f172a;
        }

        .drawer-close {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            width: 32px;
            height: 32px;
            font-size: 1rem;
            color: #64748b;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .drawer-menu {
            list-style: none;
            padding: 12px 0;
        }

        .drawer-menu li {
            padding: 14px 20px;
            font-size: 0.88rem;
            font-weight: 600;
            color: #475569;
            cursor: pointer;
            border-left: 4px solid transparent;
            display: flex;
            align-items: center;
            gap: 12px;
            transition: all 0.2s;
        }

        .drawer-menu li i {
            font-size: 1rem;
            width: 20px;
            text-align: center;
            color: #64748b;
        }

        .drawer-menu li.active {
            background: #eff6ff;
            color: #2563eb;
            border-left-color: #2563eb;
            font-weight: 700;
        }

        .drawer-menu li.active i {
            color: #2563eb;
        }

        .page-section {
            display: none;
            padding: 14px;
            animation: fadeIn 0.3s ease-in-out;
        }

        .page-section.active {
            display: block;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .card {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 14px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .card-title {
            font-size: 0.82rem;
            font-weight: 800;
            color: #0f172a;
            margin-bottom: 14px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 1px solid #f1f5f9;
            padding-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .card-title i {
            color: #2563eb;
            font-size: 0.95rem;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-bottom: 14px;
        }

        .stat-box {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 10px;
            padding: 14px;
            text-align: center;
            box-shadow: 0 1px 2px rgba(0,0,0,0.02);
            position: relative;
            overflow: hidden;
        }

        .stat-box i {
            position: absolute;
            right: -8px;
            bottom: -8px;
            font-size: 2.2rem;
            color: #f1f5f9;
            z-index: 0;
        }

        .stat-box .number {
            font-size: 1.5rem;
            font-weight: 800;
            color: #2563eb;
            position: relative;
            z-index: 1;
        }

        .stat-box .label {
            font-size: 0.65rem;
            color: #64748b;
            margin-top: 4px;
            font-weight: 700;
            position: relative;
            z-index: 1;
        }

        .form-group {
            margin-bottom: 12px;
        }

        .form-group label {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.7rem;
            font-weight: 700;
            color: #334155;
            margin-bottom: 6px;
        }

        .form-control {
            width: 100%;
            background: #ffffff;
            border: 1px solid #cbd5e1;
            padding: 10px 12px;
            border-radius: 8px;
            color: #0f172a;
            font-size: 0.85rem;
            outline: none;
            transition: border-color 0.2s, box-shadow 0.2s;
        }

        .form-control:focus {
            border-color: #2563eb;
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }

        textarea.form-control {
            resize: vertical;
            height: 75px;
        }

        .btn {
            width: 100%;
            background: #2563eb;
            border: none;
            padding: 11px;
            border-radius: 8px;
            color: #ffffff;
            font-size: 0.8rem;
            font-weight: 700;
            cursor: pointer;
            text-align: center;
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 8px;
            box-shadow: 0 2px 4px rgba(37, 99, 235, 0.15);
            transition: all 0.2s ease;
        }

        .btn:active {
            transform: scale(0.98);
            opacity: 0.9;
        }

        .btn-danger {
            background: #dc2626;
            box-shadow: 0 2px 4px rgba(220, 38, 38, 0.15);
        }

        .btn-success {
            background: #16a34a;
            box-shadow: 0 2px 4px rgba(22, 163, 74, 0.15);
        }

        .btn-secondary {
            background: #f1f5f9;
            color: #334155;
            border: 1px solid #cbd5e1;
            box-shadow: none;
        }

        .pairing-box {
            text-align: center;
            background: #eff6ff;
            border: 1px dashed #2563eb;
            padding: 14px;
            border-radius: 10px;
            margin-top: 12px;
            display: none;
        }

        .pairing-code {
            font-size: 1.7rem;
            font-weight: 800;
            color: #2563eb;
            letter-spacing: 4px;
            margin: 8px 0;
        }

        .chat-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-height: 280px;
            overflow-y: auto;
        }

        .chat-item {
            background: #f8fafc;
            border-left: 3px solid #2563eb;
            padding: 10px;
            border-radius: 6px;
            font-size: 0.78rem;
        }

        .chat-item.assistant {
            border-left-color: #9333ea;
            background: #faf5ff;
        }

        .chat-header {
            display: flex;
            justify-content: space-between;
            color: #64748b;
            font-size: 0.65rem;
            margin-bottom: 3px;
        }

        .chat-user {
            color: #2563eb;
            font-weight: 700;
        }

        .chat-item.assistant .chat-user {
            color: #9333ea;
        }

        .chat-body {
            color: #1e293b;
            word-break: break-word;
            line-height: 1.35;
        }

        .conversation-card {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 12px;
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: all 0.2s;
        }

        .conversation-card:hover, .conversation-card.active {
            border-color: #2563eb;
            background: #f0f7ff;
        }

        .owner-item, .bot-card {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 12px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            margin-bottom: 8px;
        }

        .toast {
            position: fixed;
            top: 15px;
            left: 50%;
            transform: translateX(-50%) translateY(-100px);
            background: #0f172a;
            color: #ffffff;
            padding: 10px 18px;
            border-radius: 24px;
            font-size: 0.78rem;
            font-weight: 600;
            z-index: 1000;
            transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .toast.show {
            transform: translateX(-50%) translateY(0);
        }
    </style>
</head>
<body>

    <!-- Header Navigation Mobile -->
    <header>
        <div class="header-left">
            <button class="burger-btn" onclick="toggleDrawer()">
                <i class="fa-solid fa-bars"></i>
            </button>
            <h1><i class="fa-solid fa-microchip"></i> Zack Control</h1>
        </div>
        <div class="api-badge" id="apiStatusBadge">
            <div class="pulse-dot"></div>
            <span id="apiStatusText">CONNECTING...</span>
        </div>
    </header>

    <!-- Side Drawer Menu -->
    <div class="drawer-overlay" id="drawerOverlay" onclick="toggleDrawer()"></div>
    <div class="drawer" id="drawer">
        <div class="drawer-header">
            <span>Pilih Fitur</span>
            <button class="drawer-close" onclick="toggleDrawer()"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <ul class="drawer-menu">
            <li class="active" onclick="switchTab(0)"><i class="fa-solid fa-chart-line"></i> Dashboard & Log</li>
            <li onclick="switchTab(1)"><i class="fa-solid fa-sliders"></i> Pengaturan Khusus Bot</li>
            <li onclick="switchTab(2)"><i class="fa-solid fa-qrcode"></i> Pairing & Bot Active</li>
            <li onclick="switchTab(3)"><i class="fa-solid fa-paper-plane"></i> Kirim Pesan & Media</li>
            <li onclick="switchTab(4)"><i class="fa-solid fa-database"></i> Backup & Restore Data</li>
        </ul>
    </div>

    <!-- PAGE 0: DASHBOARD -->
    <div class="page-section active" id="sec-0">
        <div class="stats-grid">
            <div class="stat-box">
                <i class="fa-solid fa-robot"></i>
                <div class="number" id="statBotCount">0</div>
                <div class="label">BOT AKTIF</div>
            </div>
            <div class="stat-box">
                <i class="fa-solid fa-comments"></i>
                <div class="number" id="statLogsCount">0</div>
                <div class="label">LOG CHAT</div>
            </div>
        </div>

        <div class="card">
            <div class="card-title"><i class="fa-solid fa-brain"></i> Tes Respon AI (Aisyah AI / Zack)</div>
            <div class="form-group">
                <label><i class="fa-solid fa-message"></i> Pesan Tes</label>
                <input type="text" id="testAiMsg" class="form-control" placeholder="Contoh: Kamu siapa?">
            </div>
            <div class="form-group">
                <label><i class="fa-solid fa-user-tag"></i> Perlakuan Sender</label>
                <select id="testAiRole" class="form-control">
                    <option value="false">Sebagai Orang Lain (Aisyah AI - Ramah & Netral)</option>
                    <option value="true">Sebagai Owner (Aisyah - Pacar Manis)</option>
                </select>
            </div>
            <button class="btn" onclick="runTestAi()"><i class="fa-solid fa-vial"></i> Tes Respon AI</button>
            <div id="testAiResult" style="margin-top:10px; font-size:0.75rem; color:#2563eb; display:none; background:#f0f7ff; padding:10px; border-radius:8px; border:1px solid #bfdbfe;"></div>
        </div>

        <div class="card">
            <div class="card-title"><i class="fa-solid fa-desktop"></i> Live Monitoring Chat (Rinci)</div>
            <div class="chat-list" id="monitoringLogs">
                <div style="text-align:center; font-size:0.75rem; color:#64748b; padding:15px;">Memuat data...</div>
            </div>
        </div>
    </div>

    <!-- PAGE 1: PENGATURAN KHUSUS BOT & OWNER -->
    <div class="page-section" id="sec-1">
        <!-- PENGATURAN SPESIFIK BOT -->
        <div class="card">
            <div class="card-title"><i class="fa-solid fa-sliders"></i> Custom Pengaturan Bot Spesifik</div>
            <div class="form-group">
                <label><i class="fa-solid fa-robot"></i> Pilih Bot Yang Diatur</label>
                <select id="configBotSelect" class="form-control" onchange="loadSpecificBotConfig()">
                    <option value="">-- Pilih Bot --</option>
                </select>
            </div>
            <div class="form-group">
                <label><i class="fa-solid fa-phone"></i> Nomor Owner Khusus Bot Ini</label>
                <input type="number" id="botOwnerNum" class="form-control" placeholder="628123456789">
            </div>
            <div class="form-group">
                <label><i class="fa-solid fa-signature"></i> Custom Nama Owner (Dipanggil AI)</label>
                <input type="text" id="botOwnerName" class="form-control" placeholder="Contoh: Zack / Mas Alex">
            </div>
            <div class="form-group">
                <label><i class="fa-solid fa-check-double"></i> Auto Read Pesan Bot Ini</label>
                <select id="botAutoReadSelect" class="form-control">
                    <option value="false">OFF (Matikan AutoRead)</option>
                    <option value="true">ON (Aktifkan AutoRead)</option>
                </select>
            </div>
            <div class="form-group">
                <label><i class="fa-solid fa-clock"></i> Notifikasi Rutinitas Harian Bot Ini</label>
                <select id="botRoutineSelect" class="form-control">
                    <option value="true">ON (Kirim Rutinitas Harian AI)</option>
                    <option value="false">OFF (Matikan Rutinitas Harian)</option>
                </select>
            </div>
            <button class="btn" onclick="saveBotSpecificConfig()"><i class="fa-solid fa-floppy-disk"></i> Simpan Pengaturan Bot</button>
        </div>

        <div class="card">
            <div class="card-title"><i class="fa-solid fa-user-shield"></i> Daftar Owner Global (Admin)</div>
            <div class="form-group">
                <label><i class="fa-solid fa-phone"></i> Tambah Nomor Owner Admin Baru</label>
                <input type="number" id="newOwnerNum" class="form-control" placeholder="628123456789">
            </div>
            <button class="btn" onclick="addOwner()"><i class="fa-solid fa-user-plus"></i> Tambah Owner Global</button>
            
            <div style="margin-top:12px;" id="ownerListContainer">
                <div style="text-align:center; font-size:0.75rem; color:#64748b;"><i class="fa-solid fa-spinner fa-spin"></i> Memuat daftar owner...</div>
            </div>
        </div>

        <div class="card">
            <div class="card-title"><i class="fa-solid fa-bullhorn"></i> Kirim Broadcast Ke Semua Kontak</div>
            <div class="form-group">
                <label><i class="fa-solid fa-robot"></i> Dari Bot</label>
                <select id="broadcastBotSelect" class="form-control">
                    <option value="">-- Pilih Bot --</option>
                </select>
            </div>
            <div class="form-group">
                <label><i class="fa-solid fa-comment-dots"></i> Pesan Broadcast</label>
                <textarea id="broadcastText" class="form-control" placeholder="Pengumuman / Pesan broadcast..."></textarea>
            </div>
            <button class="btn btn-success" onclick="sendBroadcast()"><i class="fa-solid fa-paper-plane"></i> Kirim Broadcast Kontak</button>
        </div>
    </div>

    <!-- PAGE 2: PAIRING & BOTS -->
    <div class="page-section" id="sec-2">
        <div class="card">
            <div class="card-title"><i class="fa-solid fa-qrcode"></i> Generate Pairing Code</div>
            <div class="form-group">
                <label><i class="fa-solid fa-mobile-screen"></i> Nomor WhatsApp Bot</label>
                <input type="number" id="pairNumber" class="form-control" placeholder="628123456789">
            </div>
            <button class="btn" onclick="requestPairing()"><i class="fa-solid fa-key"></i> Minta Kode Pairing</button>

            <div class="pairing-box" id="pairingBox">
                <div style="font-size:0.68rem; color:#64748b; font-weight:700;">KODE PAIRING ANDA</div>
                <div class="pairing-code" id="pairingCodeVal">----</div>
                <div style="font-size:0.65rem; color:#64748b;">Masukkan kode ini di WhatsApp HP Anda</div>
            </div>
        </div>

        <div class="card">
            <div class="card-title"><i class="fa-solid fa-file-arrow-up"></i> Upload Session (.ZIP)</div>
            <div class="form-group">
                <label><i class="fa-solid fa-phone"></i> Nomor Bot</label>
                <input type="number" id="zipNumber" class="form-control" placeholder="628123456789">
            </div>
            <div class="form-group">
                <label><i class="fa-solid fa-file-zipper"></i> File Sesi (.ZIP)</label>
                <input type="file" id="zipFile" accept=".zip" class="form-control">
            </div>
            <button class="btn" onclick="uploadZipSession()"><i class="fa-solid fa-cloud-arrow-up"></i> Upload & Ekstrak</button>
        </div>

        <div class="card">
            <div class="card-title"><i class="fa-solid fa-plug"></i> Daftar Bot Terhubung & Download Sesi</div>
            <div id="botListContainer">
                <div style="text-align:center; font-size:0.75rem; color:#64748b; padding:15px;">Belum ada bot.</div>
            </div>
        </div>
    </div>

    <!-- PAGE 3: KIRIM PESAN & MEDIA -->
    <div class="page-section" id="sec-3">
        <div class="card">
            <div class="card-title"><i class="fa-solid fa-paper-plane"></i> Kirim Pesan Teks</div>
            <div class="form-group">
                <label><i class="fa-solid fa-robot"></i> Pilih Bot Pengirim</label>
                <select id="sendMsgBotSelect" class="form-control">
                    <option value="">-- Pilih Bot --</option>
                </select>
            </div>
            <div class="form-group">
                <label><i class="fa-solid fa-user-check"></i> Pilih / Ketik Target</label>
                <input type="text" id="sendMsgTarget" class="form-control" placeholder="Nomor / JID (Contoh: 628xxx)">
            </div>
            <div class="form-group">
                <label><i class="fa-solid fa-pen"></i> Isi Pesan</label>
                <textarea id="sendMsgText" class="form-control" placeholder="Ketik pesan di sini..."></textarea>
            </div>
            <button class="btn" onclick="sendTextMessage()"><i class="fa-solid fa-paper-plane"></i> Kirim Pesan</button>
        </div>

        <div class="card">
            <div class="card-title"><i class="fa-solid fa-photo-film"></i> Kirim Media (Upload File Langsung)</div>
            <div class="form-group">
                <label><i class="fa-solid fa-robot"></i> Pilih Bot Pengirim</label>
                <select id="mediaBotSelect" class="form-control">
                    <option value="">-- Pilih Bot --</option>
                </select>
            </div>
            <div class="form-group">
                <label><i class="fa-solid fa-user"></i> Target Nomor / JID</label>
                <input type="text" id="mediaTarget" class="form-control" placeholder="628xxx">
            </div>
            <div class="form-group">
                <label><i class="fa-solid fa-icons"></i> Tipe Media</label>
                <select id="mediaType" class="form-control">
                    <option value="image">Gambar (Image)</option>
                    <option value="video">Video</option>
                    <option value="audio">Audio / Voice Note</option>
                    <option value="document">Dokumen / File</option>
                </select>
            </div>
            <div class="form-group">
                <label><i class="fa-solid fa-file-arrow-up"></i> Upload File Media</label>
                <input type="file" id="mediaFileInput" class="form-control">
            </div>
            <div class="form-group">
                <label><i class="fa-solid fa-closed-captioning"></i> Caption / Description</label>
                <input type="text" id="mediaCaption" class="form-control" placeholder="Keterangan file...">
            </div>
            <button class="btn" onclick="sendMediaMessage()"><i class="fa-solid fa-share-nodes"></i> Upload & Kirim Media</button>
        </div>
    </div>

    <!-- PAGE 4: DATABASE & BACKUP/RESTORE DATA -->
    <div class="page-section" id="sec-4">
        <!-- FITUR BARU: BACKUP & RESTORE BACKUP .ZIP -->
        <div class="card">
            <div class="card-title"><i class="fa-solid fa-server"></i> Cek, Backup & Restore Full Data</div>
            <div class="stats-grid" style="margin-bottom:12px;">
                <div class="stat-box">
                    <i class="fa-solid fa-users"></i>
                    <div class="number" id="dbUsersCount">0</div>
                    <div class="label">USER DATABASE</div>
                </div>
                <div class="stat-box">
                    <i class="fa-solid fa-file-code"></i>
                    <div class="number" id="dbChatsCount">0</div>
                    <div class="label">FILE CHAT</div>
                </div>
            </div>
            <button class="btn btn-success" style="margin-bottom:10px;" onclick="downloadDbBackup()"><i class="fa-solid fa-file-zipper"></i> Download Full Backup (.ZIP)</button>
            
            <div style="border-top:1px solid #f1f5f9; padding-top:10px; margin-top:10px;">
                <div class="form-group">
                    <label><i class="fa-solid fa-upload"></i> Upload & Restore File Backup (.ZIP)</label>
                    <input type="file" id="restoreBackupZipFile" accept=".zip" class="form-control">
                </div>
                <button class="btn btn-secondary" onclick="uploadRestoreBackup()"><i class="fa-solid fa-rotate-left"></i> Restore Data Dari Backup</button>
            </div>
        </div>

        <div class="card">
            <div class="card-title"><i class="fa-solid fa-comments"></i> Riwayat Chat (Klik untuk Detail)</div>
            <div id="conversationListContainer">
                <div style="text-align:center; font-size:0.75rem; color:#64748b; padding:15px;"><i class="fa-solid fa-spinner fa-spin"></i> Memuat daftar percakapan...</div>
            </div>

            <div id="chatDetailBox" style="display:none; margin-top:12px; border-top:1px solid #e2e8f0; padding-top:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span id="chatDetailTitle" style="font-size:0.8rem; font-weight:700; color:#2563eb;">--</span>
                    <div style="display:flex; gap:6px;">
                        <button class="btn btn-danger" style="width:auto; padding:4px 8px; font-size:0.65rem;" id="btnDeleteChatHist"><i class="fa-solid fa-trash"></i> Hapus</button>
                        <button class="btn btn-secondary" style="width:auto; padding:4px 8px; font-size:0.65rem;" onclick="closeChatDetail()"><i class="fa-solid fa-xmark"></i> Tutup</button>
                    </div>
                </div>
                <div class="chat-list" id="chatDetailContainer"></div>
            </div>
        </div>

        <div class="card">
            <div class="card-title"><i class="fa-solid fa-brain"></i> Memori Fakta Zack</div>
            <div class="form-group">
                <label><i class="fa-solid fa-key"></i> Nama Fakta (Key)</label>
                <input type="text" id="factKey" class="form-control" placeholder="Contoh: Makanan Favorit">
            </div>
            <div class="form-group">
                <label><i class="fa-solid fa-quote-left"></i> Isi Fakta (Value)</label>
                <input type="text" id="factVal" class="form-control" placeholder="Contoh: Nasi Goreng Pedas">
            </div>
            <button class="btn" onclick="saveFact()"><i class="fa-solid fa-floppy-disk"></i> Simpan Memori AI</button>
            
            <div style="margin-top:12px;" id="factsListContainer">
                <div style="text-align:center; font-size:0.75rem; color:#64748b;">Memuat memori...</div>
            </div>
        </div>

        <div class="card">
            <div class="card-title"><i class="fa-solid fa-address-book"></i> Kontak Tersimpan</div>
            <div id="contactListContainer" style="font-size:0.75rem;">
                <div style="text-align:center; color:#64748b; padding:10px;"><i class="fa-solid fa-spinner fa-spin"></i> Memuat kontak...</div>
            </div>
        </div>
    </div>

    <div class="toast" id="toast"><i class="fa-solid fa-circle-info"></i> <span id="toastMsg">Notifikasi</span></div>

    <script>
        const API_BASE = window.location.origin;
        let currentTab = 0;
        let activeBotsList = [];

        function showToast(msg) {
            const toast = document.getElementById('toast');
            document.getElementById('toastMsg').innerText = msg;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        function toggleDrawer() {
            document.getElementById('drawer').classList.toggle('active');
            document.getElementById('drawerOverlay').classList.toggle('active');
        }

        function switchTab(index) {
            currentTab = index;
            document.querySelectorAll('.drawer-menu li').forEach((item, i) => {
                if (i === index) item.classList.add('active');
                else item.classList.remove('active');
            });
            document.querySelectorAll('.page-section').forEach((sec, i) => {
                if (i === index) sec.classList.add('active');
                else sec.classList.remove('active');
            });
            toggleDrawer();

            if (index === 0) fetchMonitoring();
            if (index === 1) { fetchOwners(); populateBotDropdowns(); }
            if (index === 2) fetchBots();
            if (index === 3) populateBotDropdowns();
            if (index === 4) { fetchDbStatus(); fetchConversations(); fetchFactsList(); fetchContacts(); }
        }

        async function checkAPIStatus() {
            try {
                const res = await fetch(`${API_BASE}/api/bots`);
                if (res.ok) {
                    document.getElementById('apiStatusBadge').classList.remove('offline');
                    document.getElementById('apiStatusText').innerText = 'ONLINE';
                } else throw new Error();
            } catch (e) {
                document.getElementById('apiStatusBadge').classList.add('offline');
                document.getElementById('apiStatusText').innerText = 'OFFLINE';
            }
        }

        async function fetchOwners() {
            try {
                const res = await fetch(`${API_BASE}/api/owner`);
                const data = await res.json();
                const container = document.getElementById('ownerListContainer');
                if (data.status && data.owners.length > 0) {
                    container.innerHTML = data.owners.map(num => `
                        <div class="owner-item">
                            <span style="font-weight:700; font-size:0.8rem;"><i class="fa-solid fa-user-check" style="color:#2563eb;"></i> ${num} <small style="color:#9333ea;">(Admin Global)</small></span>
                            <button class="btn btn-danger" style="width:auto; padding:4px 10px;" onclick="deleteOwner('${num}')">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    `).join('');
                } else {
                    container.innerHTML = '<div style="text-align:center; color:#64748b; font-size:0.75rem;">Belum ada owner tersimpan.</div>';
                }
            } catch (e) {
                showToast('Gagal memuat list owner');
            }
        }

        async function addOwner() {
            const number = document.getElementById('newOwnerNum').value;
            if (!number) return showToast('Isi nomor owner!');

            try {
                const res = await fetch(`${API_BASE}/api/owner`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ number })
                });
                const data = await res.json();
                showToast(data.message);
                document.getElementById('newOwnerNum').value = '';
                fetchOwners();
            } catch (e) {
                showToast('Gagal menambah owner');
            }
        }

        async function deleteOwner(num) {
            if (!confirm(`Hapus ${num} dari owner?`)) return;
            try {
                const res = await fetch(`${API_BASE}/api/owner/${num}`, { method: 'DELETE' });
                const data = await res.json();
                showToast(data.message);
                fetchOwners();
            } catch (e) {
                showToast('Gagal menghapus owner');
            }
        }

        // LOAD & SAVE CUSTOM CONFIG KHUSUS PER BOT
        async function loadSpecificBotConfig() {
            const botNumber = document.getElementById('configBotSelect').value;
            if (!botNumber) return;

            try {
                const res = await fetch(`${API_BASE}/api/bot-config/${botNumber}`);
                const data = await res.json();
                if (data.status && data.config) {
                    document.getElementById('botOwnerNum').value = data.config.ownerNumber || '';
                    document.getElementById('botOwnerName').value = data.config.ownerName || 'Zack';
                    document.getElementById('botAutoReadSelect').value = String(data.config.autoRead || false);
                    document.getElementById('botRoutineSelect').value = String(data.config.routineEnabled !== false);
                }
            } catch (e) {
                showToast('Gagal memuat pengaturan bot');
            }
        }

        async function saveBotSpecificConfig() {
            const number = document.getElementById('configBotSelect').value;
            const ownerNumber = document.getElementById('botOwnerNum').value;
            const ownerName = document.getElementById('botOwnerName').value;
            const autoRead = document.getElementById('botAutoReadSelect').value === 'true';
            const routineEnabled = document.getElementById('botRoutineSelect').value === 'true';

            if (!number) return showToast('Pilih bot terlebih dahulu!');

            try {
                const res = await fetch(`${API_BASE}/api/bot-config`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ number, ownerNumber, ownerName, autoRead, routineEnabled })
                });
                const data = await res.json();
                showToast(data.message);
            } catch (e) {
                showToast('Gagal menyimpan pengaturan bot');
            }
        }

        async function runTestAi() {
            const message = document.getElementById('testAiMsg').value || 'Kamu siapa?';
            const isZack = document.getElementById('testAiRole').value === 'true';
            const resBox = document.getElementById('testAiResult');

            resBox.style.display = 'block';
            resBox.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses respon AI...';

            try {
                const res = await fetch(`${API_BASE}/api/test-ai?message=${encodeURIComponent(message)}&isZack=${isZack}`);
                const data = await res.json();
                resBox.innerText = `[AI Respon]: ${data.aiResponse}`;
            } catch (e) {
                resBox.innerText = '[Error]: Gagal menghubungi API server.';
            }
        }

        async function fetchMonitoring() {
            try {
                const res = await fetch(`${API_BASE}/api/monitoring`);
                const data = await res.json();
                if (data.status) {
                    document.getElementById('statBotCount').innerText = data.totalActiveBots || 0;
                    document.getElementById('statLogsCount').innerText = data.recentChatLogs ? data.recentChatLogs.length : 0;

                    const container = document.getElementById('monitoringLogs');
                    if (!data.recentChatLogs || data.recentChatLogs.length === 0) {
                        container.innerHTML = '<div style="text-align:center; font-size:0.75rem; color:#64748b; padding:15px;">Belum ada log pesan.</div>';
                        return;
                    }

                    container.innerHTML = data.recentChatLogs.map(log => `
                        <div class="chat-item ${log.role}">
                            <div class="chat-header">
                                <span class="chat-user">
                                    <i class="fa-solid fa-robot" style="color:#2563eb;"></i> Bot [${log.botNumber}] &nbsp;|&nbsp; 
                                    <i class="fa-solid fa-user"></i> ${log.userName} (${log.isZack ? 'Owner ❤️' : 'User'})
                                </span>
                                <span>${new Date(log.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <div class="chat-body">${log.content}</div>
                        </div>
                    `).join('');
                }
            } catch (e) {}
        }

        async function requestPairing() {
            const num = document.getElementById('pairNumber').value;
            if (!num) return showToast('Masukkan nomor bot!');

            try {
                const res = await fetch(`${API_BASE}/api/pairing?number=${num}`);
                const data = await res.json();
                if (data.status) {
                    document.getElementById('pairingBox').style.display = 'block';
                    document.getElementById('pairingCodeVal').innerText = data.pairingCode || '----';
                } else showToast(data.message);
            } catch (e) {
                showToast('Gagal terhubung ke API');
            }
        }

        async function uploadZipSession() {
            const num = document.getElementById('zipNumber').value;
            const fileInput = document.getElementById('zipFile');

            if (!num || fileInput.files.length === 0) return showToast('Isi nomor & pilih file .zip!');

            const formData = new FormData();
            formData.append('number', num);
            formData.append('sessionZip', fileInput.files[0]);

            showToast('Mengupload sesi zip...');
            try {
                const res = await fetch(`${API_BASE}/api/upload-session`, { method: 'POST', body: formData });
                const data = await res.json();
                showToast(data.message);
            } catch (e) {
                showToast('Gagal upload sesi zip');
            }
        }

        async function fetchBots() {
            try {
                const res = await fetch(`${API_BASE}/api/bots`);
                const data = await res.json();
                activeBotsList = data.bots || [];
                const container = document.getElementById('botListContainer');

                if (data.status && data.bots.length > 0) {
                    container.innerHTML = data.bots.map(bot => `
                        <div class="bot-card">
                            <div>
                                <div style="font-weight:700; font-size:0.8rem;"><i class="fa-solid fa-robot" style="color:#2563eb;"></i> ${bot.number}</div>
                                <div style="font-size:0.65rem; color:#64748b;">Owner: <b>${bot.ownerName}</b> (${bot.ownerNumber}) | Status: <span style="color:#16a34a; font-weight:700;">${bot.status}</span></div>
                            </div>
                            <div style="display:flex; gap:6px;">
                                <a href="${API_BASE}/api/bot/download-session/${bot.number}" class="btn btn-secondary" style="width:auto; padding:6px 10px; font-size:0.7rem;" title="Download Sesi ZIP">
                                    <i class="fa-solid fa-download"></i> Sesi
                                </a>
                                <button class="btn btn-danger" style="width:auto; padding:6px 10px;" onclick="deleteBot('${bot.number}')">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    `).join('');
                } else {
                    container.innerHTML = '<div style="text-align:center; font-size:0.75rem; color:#64748b; padding:15px;">Belum ada bot terhubung.</div>';
                }
            } catch (e) {}
        }

        async function deleteBot(num) {
            if (!confirm(`Hapus sesi bot ${num}?`)) return;
            try {
                const res = await fetch(`${API_BASE}/api/bot/${num}`, { method: 'DELETE' });
                const data = await res.json();
                showToast(data.message);
                fetchBots();
            } catch (e) {
                showToast('Gagal menghapus bot');
            }
        }

        async function populateBotDropdowns() {
            await fetchBots();
            const selects = [
                document.getElementById('sendMsgBotSelect'), 
                document.getElementById('mediaBotSelect'),
                document.getElementById('broadcastBotSelect'),
                document.getElementById('configBotSelect')
            ];
            selects.forEach(select => {
                if (!select) return;
                const currentVal = select.value;
                select.innerHTML = '<option value="">-- Pilih Bot --</option>';
                activeBotsList.forEach(b => {
                    select.innerHTML += `<option value="${b.number}">${b.number} (${b.ownerName})</option>`;
                });
                if (currentVal) select.value = currentVal;
            });
        }

        async function sendTextMessage() {
            const number = document.getElementById('sendMsgBotSelect').value;
            const targetJid = document.getElementById('sendMsgTarget').value;
            const message = document.getElementById('sendMsgText').value;

            if (!number || !targetJid || !message) return showToast('Pilih bot, target, & isi pesan!');

            try {
                const res = await fetch(`${API_BASE}/api/send-message`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ number, targetJid, message })
                });
                const data = await res.json();
                showToast(data.message);
                if (data.status) document.getElementById('sendMsgText').value = '';
            } catch (e) {
                showToast('Gagal mengirim pesan');
            }
        }

        async function sendMediaMessage() {
            const number = document.getElementById('mediaBotSelect').value;
            const targetJid = document.getElementById('mediaTarget').value;
            const type = document.getElementById('mediaType').value;
            const caption = document.getElementById('mediaCaption').value;
            const fileInput = document.getElementById('mediaFileInput');

            if (!number || !targetJid || fileInput.files.length === 0) {
                return showToast('Pilih bot, target, & pilih file media!');
            }

            const formData = new FormData();
            formData.append('number', number);
            formData.append('targetJid', targetJid);
            formData.append('type', type);
            formData.append('caption', caption);
            formData.append('mediaFile', fileInput.files[0]);

            showToast('Mengupload & mengirim media...');
            try {
                const res = await fetch(`${API_BASE}/api/send-media`, {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();
                showToast(data.message);
                if (data.status) {
                    document.getElementById('mediaCaption').value = '';
                    fileInput.value = '';
                }
            } catch (e) {
                showToast('Gagal mengirim media');
            }
        }

        async function sendBroadcast() {
            const number = document.getElementById('broadcastBotSelect').value;
            const message = document.getElementById('broadcastText').value;

            if (!number || !message) return showToast('Pilih bot & isi pesan broadcast!');

            showToast('Mengirim broadcast ke seluruh kontak...');
            try {
                const res = await fetch(`${API_BASE}/api/broadcast`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ number, message })
                });
                const data = await res.json();
                showToast(data.message);
                if (data.status) document.getElementById('broadcastText').value = '';
            } catch (e) {
                showToast('Gagal mengirim broadcast');
            }
        }

        async function fetchDbStatus() {
            try {
                const res = await fetch(`${API_BASE}/api/db-status`);
                const data = await res.json();
                if (data.status) {
                    document.getElementById('dbUsersCount').innerText = data.stats.totalUsers || 0;
                    document.getElementById('dbChatsCount').innerText = data.stats.totalChatFiles || 0;
                }
            } catch (e) {}
        }

        function downloadDbBackup() {
            showToast('Mengunduh FULL Backup (Database & Sessions) .ZIP...');
            window.location.href = `${API_BASE}/api/backup-db`;
        }

        // FITUR BARU: UPLOAD & RESTORE BACKUP DATA
        async function uploadRestoreBackup() {
            const fileInput = document.getElementById('restoreBackupZipFile');
            if (fileInput.files.length === 0) return showToast('Pilih file backup (.zip) terlebih dahulu!');

            if (!confirm('Peringatan: Memulihkan backup akan menimpa data & sesi saat ini. Lanjutkan?')) return;

            const formData = new FormData();
            formData.append('backupZip', fileInput.files[0]);

            showToast('Memulihkan seluruh data dari backup...');
            try {
                const res = await fetch(`${API_BASE}/api/restore-backup`, {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();
                showToast(data.message);
                if (data.status) {
                    fileInput.value = '';
                    fetchDbStatus();
                    fetchBots();
                }
            } catch (e) {
                showToast('Gagal merestore backup');
            }
        }

        async function fetchConversations() {
            const container = document.getElementById('conversationListContainer');
            try {
                const res = await fetch(`${API_BASE}/api/chats/conversations`);
                const data = await res.json();

                if (data.status && data.conversations.length > 0) {
                    container.innerHTML = data.conversations.map(c => `
                        <div class="conversation-card" onclick="openChatDetail('${c.botNumber}', '${c.userJid}', '${c.userName}')">
                            <div>
                                <div style="font-weight:700; font-size:0.8rem; color:#0f172a;">
                                    ${c.userName} ${c.isZack ? '<span style="color:#9333ea; font-size:0.65rem;">[Owner ❤️]</span>' : ''}
                                </div>
                                <div style="font-size:0.68rem; color:#64748b; margin-top:2px;">
                                    ${c.lastContent.substring(0, 35)}...
                                </div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:0.6rem; color:#94a3b8;">${new Date(c.lastTimestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                                <div style="font-size:0.65rem; color:#2563eb; font-weight:700; margin-top:2px;"><i class="fa-solid fa-comments"></i> ${c.totalMessages} msg</div>
                            </div>
                        </div>
                    `).join('');
                } else {
                    container.innerHTML = '<div style="text-align:center; color:#64748b; padding:12px; font-size:0.75rem;">Belum ada riwayat percakapan.</div>';
                }
            } catch (e) {
                container.innerHTML = '<div style="text-align:center; color:#dc2626; padding:10px; font-size:0.75rem;">Gagal memuat riwayat.</div>';
            }
        }

        async function openChatDetail(botNumber, userJid, userName) {
            const detailBox = document.getElementById('chatDetailBox');
            const detailTitle = document.getElementById('chatDetailTitle');
            const container = document.getElementById('chatDetailContainer');
            const btnDelete = document.getElementById('btnDeleteChatHist');

            detailBox.style.display = 'block';
            detailTitle.innerHTML = `<i class="fa-solid fa-message"></i> ${userName} (${userJid})`;
            btnDelete.onclick = () => deleteChatHistory(botNumber, userJid);

            container.innerHTML = '<div style="text-align:center; color:#64748b; padding:10px;"><i class="fa-solid fa-spinner fa-spin"></i> Memuat chat...</div>';

            try {
                const res = await fetch(`${API_BASE}/api/chats?botNumber=${botNumber}&userJid=${userJid}`);
                const data = await res.json();

                if (data.status && data.chats.length > 0) {
                    container.innerHTML = data.chats.map(chat => `
                        <div class="chat-item ${chat.role}">
                            <div class="chat-header">
                                <span class="chat-user">${chat.userName}</span>
                                <span>${new Date(chat.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <div class="chat-body">${chat.content}</div>
                        </div>
                    `).join('');
                } else {
                    container.innerHTML = '<div style="text-align:center; color:#64748b; padding:10px;">Tidak ada riwayat chat.</div>';
                }
            } catch (e) {
                container.innerHTML = '<div style="text-align:center; color:#dc2626; padding:10px;">Gagal mengambil detail chat.</div>';
            }
        }

        async function deleteChatHistory(botNumber, userJid) {
            if (!confirm(`Hapus riwayat chat ini?`)) return;
            try {
                const res = await fetch(`${API_BASE}/api/chats?botNumber=${botNumber}&userJid=${userJid}`, { method: 'DELETE' });
                const data = await res.json();
                showToast(data.message);
                closeChatDetail();
                fetchConversations();
            } catch (e) {
                showToast('Gagal menghapus riwayat chat');
            }
        }

        function closeChatDetail() {
            document.getElementById('chatDetailBox').style.display = 'none';
        }

        async function fetchFactsList() {
            try {
                const res = await fetch(`${API_BASE}/api/facts`);
                const data = await res.json();
                const container = document.getElementById('factsListContainer');

                if (data.status && data.facts.length > 0) {
                    container.innerHTML = data.facts.map(f => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #f1f5f9;">
                            <div>
                                <span style="font-weight:700; font-size:0.75rem; color:#2563eb;">${f.factKey}</span>
                                <div style="font-size:0.7rem; color:#334155;">${f.factValue}</div>
                            </div>
                            <button class="btn btn-danger" style="width:auto; padding:4px 8px; font-size:0.6rem;" onclick="deleteFact('${f.factKey}')">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    `).join('');
                } else {
                    container.innerHTML = '<div style="text-align:center; color:#64748b; font-size:0.75rem;">Belum ada memori terdaftar.</div>';
                }
            } catch (e) {}
        }

        async function saveFact() {
            const factKey = document.getElementById('factKey').value;
            const factValue = document.getElementById('factVal').value;

            if (!factKey || !factValue) return showToast('Isi nama dan nilai fakta!');

            try {
                const res = await fetch(`${API_BASE}/api/facts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ factKey, factValue })
                });
                const data = await res.json();
                showToast(data.message);
                document.getElementById('factKey').value = '';
                document.getElementById('factVal').value = '';
                fetchFactsList();
            } catch (e) {
                showToast('Gagal menyimpan memori');
            }
        }

        async function deleteFact(key) {
            if (!confirm(`Hapus fakta '${key}'?`)) return;
            try {
                const res = await fetch(`${API_BASE}/api/facts/${encodeURIComponent(key)}`, { method: 'DELETE' });
                const data = await res.json();
                showToast(data.message);
                fetchFactsList();
            } catch (e) {
                showToast('Gagal menghapus fakta');
            }
        }

        async function fetchContacts() {
            try {
                const res = await fetch(`${API_BASE}/api/contacts`);
                const data = await res.json();
                const container = document.getElementById('contactListContainer');
                if (data.status && data.contacts.length > 0) {
                    container.innerHTML = data.contacts.map(c => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #f1f5f9;">
                            <div>
                                <span style="font-weight:700; color:#0f172a;">${c.pushName}</span> 
                                ${c.isZack ? '<span style="color:#9333ea; font-size:0.65rem;">[Owner ❤️]</span>' : ''}
                                <div style="color:#64748b; font-size:0.65rem;">${c.number}</div>
                            </div>
                            <button class="btn btn-secondary" style="width:auto; padding:4px 8px; font-size:0.62rem;" onclick="quickSelectTarget('${c.number}')">
                                <i class="fa-solid fa-paper-plane"></i> Kirim
                            </button>
                        </div>
                    `).join('');
                } else {
                    container.innerHTML = '<div style="text-align:center; color:#64748b; padding:10px;">Belum ada kontak tersimpan.</div>';
                }
            } catch (e) {}
        }

        function quickSelectTarget(num) {
            document.getElementById('sendMsgTarget').value = num;
            document.getElementById('mediaTarget').value = num;
            switchTab(3);
            showToast(`Target dipilih: ${num}`);
        }

        checkAPIStatus();
        fetchMonitoring();
        setInterval(() => {
            checkAPIStatus();
            if (currentTab === 0) fetchMonitoring();
        }, 5000);
    </script>
</body>
</html>
