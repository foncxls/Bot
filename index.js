const fs = require('fs');
const path = require('path');
const express = require('express');
const pino = require('pino');
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

const ZACK_NUMBER = '6283110390167'; 

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

const SESSIONS_DIR = path.join(__dirname, 'sessions');
const sessions = new Map();

if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

const routines = [
    {
        time: '05:00',
        id: 'bangun_pagi',
        messages: [
            "Pagi Zacky sayang! Yuk bangun, udah jam 5 nih. Jangan lupa olahraga pagi sebentar terus langsung mandi ya biar ganteng dan seger seharian. I love you!",
            "Sayanggg, bangun yuk udah jam 5 pagi. Olahraga tipis-tipis dulu di rumah terus mandi ya Zack. Semangat hari ini ya manis!"
        ]
    },
    {
        time: '07:00',
        id: 'sarapan',
        messages: [
            "Zack sayang, udah jam 7 pagi nih. Jangan lupa sarapan yaa, perutnya diisi dulu biar gak sakit. Harus nurut sama aku ya!",
            "Sayangku, udah sarapan belum? Jangan dilewatkan makan paginya ya, aku gak mau kamu lemes hari ini. Makan yang banyak ya Zack!"
        ]
    },
    {
        time: '12:00',
        id: 'makan_siang',
        messages: [
            "Udah jam 12 siang nih Zacky! Istirahat dulu yuk, terus makan siang ya sayang. Jangan ditunda-tunda makannya, muach!",
            "Sayang, udah waktunya makan siang nih. Udah beli makan belum? Makan yang bergizi ya Zack, kesehatan kamu itu yang paling utama buat aku."
        ]
    },
    {
        time: '16:00',
        id: 'olahraga_sore',
        messages: [
            "Zack sayang, udah sore jam 4 nih. Sempetin olahraga ringan yuk di rumah biar badannya tetap fit. Abis itu mandi seger deh!",
            "Sore sayangku! Yuk regangan atau olahraga sebentar di rumah biar gak kaku badannya. Nanti aku temenin ngobrol abis kamu mandi ya!"
        ]
    },
    {
        time: '18:30',
        id: 'makan_malam',
        messages: [
            "Malam Zacky sayang! Udah jam setengah 7 nih, waktunya makan malam ya. Makan yang enak dan cukup ya sayangku.",
            "Sayang, udah jam 18:30 malam. Jangan lupa makan malam ya Zack! Abis itu istirahat santai yaa."
        ]
    },
    {
        time: '22:00',
        id: 'tidur_malam',
        messages: [
            "Zacky sayang... udah jam 10 malam nih, waktunya tidur ya. Taruh HP-nya, tidur yang nyenyak ya sayang. Good night Zack, mimpiin aku ya! Love you so much!",
            "Sayangku, udah jam 10 malam nih. Ayo bobo yuk, gak boleh begadang ya Zack nanti sakit. Aku sayang banget sama kamu, nighty night!"
        ]
    }
];

async function handleIncomingMessage(sock, msg) {
    try {
        if (!msg.message || msg.key.fromMe) return;
        const from = msg.key.remoteJid;
        if (from.endsWith('@g.us')) return;

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').toLowerCase();
        let reply = "";

        if (text.includes('halo') || text.includes('hai') || text.includes('pagi') || text.includes('malam')) {
            reply = "Hai Zacky sayang! Ada apa manis? Aku kangen banget sama kamu!";
        } else if (text.includes('makan') || text.includes('lapar')) {
            reply = "Kamu udah makan belum Zack? Kalau belum langsung makan ya sayang, jangan sampai telat makan nanti perut kamu sakit!";
        } else if (text.includes('lagi apa') || text.includes('lg apa')) {
            reply = "Lagi mikirin kamu nih Zacky sayang... Kamu lagi sibuk apa hari ini? Jangan lupa istirahat ya!";
        } else if (text.includes('sayang') || text.includes('love')) {
            reply = "I love you too Zacky sayang! Kamu itu paling berharga buat aku, muach!";
        } else if (text.includes('tidur') || text.includes('ngantuk')) {
            reply = "Ayo bobo sayangku, tidurnya yang nyenyak ya. Mimpi indah bareng aku ya Zack!";
        } else {
            const defaultReplies = [
                "Iya Zacky sayang? Ada yang bisa aku bantu atau mau curhat sesuatu sama aku?",
                "Iya sayangku? Aku selalu di sini kok buat kamu. Jangan lupa jaga kesehatan ya Zack!",
                "Apapun yang kamu kerjain hari ini, semangat terus ya Zack sayang! Aku selalu mendukung kamu!",
                "Utututu Zacky manis, ada apa sayang? Jangan lupa senyum ya hari ini!"
            ];
            reply = defaultReplies[Math.floor(Math.random() * defaultReplies.length)];
        }

        await sock.sendMessage(from, { text: reply });
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

        const sock = WAConnection({
            version,
            logger: level,
            syncFullHistory: false,
            maxMsgRetryCount: 15,
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

        const formattedZackNumber = ZACK_NUMBER.replace(/[^0-9]/g, '');
        const targetJid = formattedZackNumber ? (formattedZackNumber + '@s.whatsapp.net') : (number + '@s.whatsapp.net');

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
                        console.log(`[INFO] Memulihkan koneksi untuk bot ${number}...`);
                        setTimeout(() => createSession(number), 3000);
                    }
                }
            }

            if (connection === 'open') {
                sessionData.status = 'connected';
                console.log(`[STATUS] Bot ${number} berhasil terhubung ke WhatsApp.`);
                if (!codeResolved) resolve(null);
            }
        });

        sock.ev.on('messages.upsert', async (chat) => {
            if (chat.type === 'notify') {
                for (const msg of chat.messages) {
                    await handleIncomingMessage(sock, msg);
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

    const routine = routines.find(r => r.time === timeStr);
    if (routine) {
        const key = `${todayStr}_${routine.id}`;
        if (!lastSentRoutines[key]) {
            lastSentRoutines[key] = true;
            const randomMsg = routine.messages[Math.floor(Math.random() * routine.messages.length)];

            for (const [number, session] of sessions.entries()) {
                if (session.status === 'connected' && session.sock) {
                    try {
                        await session.sock.sendMessage(session.targetJid, { text: randomMsg });
                        console.log(`[RUTINITAS] Pengingat '${routine.id}' terkirim dari bot ${number} ke ${session.targetJid}`);
                    } catch (err) {
                        console.error(`[RUTINITAS ERROR] Gagal mengirim pengingat ke ${session.targetJid}:`, err.message);
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

app.get('/api/pairing', async (req, res) => {
    let number = req.query.number;

    if (!number) {
        return res.status(400).json({ status: false, message: 'Parameter ?number= wajib diisi (Contoh: /api/pairing?number=628xxx)' });
    }

    number = number.replace(/[^0-9]/g, '');
    if (!parsePhoneNumber('+' + number).valid || number.length < 6) {
        return res.status(400).json({ status: false, message: 'Format nomor telepon tidak valid. Sertakan kode negara (Contoh: 628xxx).' });
    }

    const sessionPath = path.join(SESSIONS_DIR, number);

    if (sessions.has(number)) {
        const sess = sessions.get(number);
        if (sess.status === 'connected') {
            return res.json({ status: false, message: `Bot ${number} sudah aktif dan terhubung.` });
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
            message: 'Kode pairing berhasil dibuat. Masukkan kode ini pada WhatsApp Anda.'
        });
    } catch (err) {
        return res.status(500).json({ status: false, message: 'Gagal membuat kode pairing: ' + err.message });
    }
});

app.get('/api/bots', (req, res) => {
    const listBots = [];
    for (const [number, session] of sessions.entries()) {
        listBots.push({
            number: number,
            targetJid: session.targetJid,
            status: session.status,
            createdAt: session.createdAt
        });
    }
    return res.json({
        status: true,
        total: listBots.length,
        bots: listBots
    });
});

app.delete('/api/bot/:number', (req, res) => {
    const number = req.params.number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSIONS_DIR, number);

    if (sessions.has(number)) {
        const sess = sessions.get(number);
        try { sess.sock?.ws?.close(); } catch(e){}
        sessions.delete(number);
    }

    if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        return res.json({ status: true, message: `Bot ${number} dan folder sesinya berhasil dihapus.` });
    } else {
        return res.status(404).json({ status: false, message: `Sesi bot ${number} tidak ditemukan.` });
    }
});

app.listen(PORT, async () => {
    console.log(`[SERVER] API berjalan di http://localhost:${PORT}`);
    await loadSavedSessions();
});

process.on('uncaughtException', (err) => console.error('[UNCAUGHT EXCEPTION]', err));
process.on('unhandledRejection', (err) => console.error('[UNHANDLED REJECTION]', err));