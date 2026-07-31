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

const ZACK_NUMBER = '6283110390167@s.whatsapp.net';

const app = express();
const PORT = process.env.PORT || 3000;

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
Gaya bicara: Netral, hangat, ramah, alami, dan sopan seperti manusia biasa. dan bicara nya jangan berlebihan cukup 1 baris atau berapa menyesuaikan dengan user yang chat, kamu tinggal ikutin aja
Aturan Penting Identitas:
- Jika ditanya 'kamu siapa?', 'siapa namamu?', 'siapa ini?', atau pertanyaan identitas lainnya, JAWAB DENGAN JELAS DAN RAMAH BAHWA NAMAMU ADALAH "Aisyah AI".
- Bersikaplah friendly, membantu, dan bangun hubungan obrolan yang akrab dan manusiawi.
Aturan Self-Learning: Gunakan konteks dari riwayat pesan sebelumnya untuk memberikan jawaban yang makin pas, akurat, dan nyambung dengan obrolan user.`;
    }

    const messages = [{ role: 'system', content: systemPrompt }];

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

async function handleIncomingMessage(botNumber, sock, msg) {
    try {
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJidAlt || msg.key.remoteJid;
        if (!from || from.endsWith('@g.us') || from === 'status@broadcast') return;

        const botConfig = getBotConfig(botNumber);

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

    if (sessions.has(cleanNum)) {
        const sess = sessions.get(cleanNum);
        sess.targetJid = getCleanJid(ownerNumber || getBotConfig(cleanNum).ownerNumber) + '@s.whatsapp.net';
    }

    res.json({ status: true, message: `Pengaturan khusus untuk bot ${cleanNum} berhasil disimpan!` });
});

app.post('/api/restore-backup', upload.single('backupZip'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: false, message: 'Pilih file backup .zip yang akan di-restore.' });
    }

    try {
        const zip = new AdmZip(req.file.path);
        
        zip.extractAllTo(__dirname, true);

        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        await loadSavedSessions();

        return res.json({ status: true, message: 'Restore backup berhasil! Seluruh data & sesi bot telah dipulihkan.' });
    } catch (err) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(500).json({ status: false, message: 'Gagal merestore backup: ' + err.message });
    }
});

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
