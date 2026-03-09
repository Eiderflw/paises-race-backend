const { TikTokLiveConnection } = require('tiktok-live-connector');
const { Server } = require('socket.io');
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

require('dotenv').config();

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '')));
app.use('/gifts', express.static(path.join(__dirname, 'gifts')));

const PORT = process.env.PORT || 3001;

if (process.env.EULER_API_KEY) {
    console.log('[EULER] ✅ API Key detectada - Se usará como fallback de conexión');
} else {
    console.warn('[EULER] ⚠️  No hay EULER_API_KEY en .env - conexión básica habilitada');
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── BASE DE DATOS DE REGALOS ─────────────────────────────────────────────────
const GIFTS_DB_PATH = path.join(__dirname, 'gifts', 'gifts_database.json');
const GIFTS_IMG_DIR = path.join(__dirname, 'gifts', 'images');

// Asegurar que existan las carpetas
if (!fs.existsSync(path.join(__dirname, 'gifts'))) {
    fs.mkdirSync(path.join(__dirname, 'gifts'), { recursive: true });
}
if (!fs.existsSync(GIFTS_IMG_DIR)) {
    fs.mkdirSync(GIFTS_IMG_DIR, { recursive: true });
}

// Mapa en memoria de regalos conocidos
const receivedGifts = new Map(); // giftName -> { id, name, diamondCount, imageUrl, localImage }

/**
 * Carga la base de datos de regalos del archivo JSON y la pone en memoria
 */
function loadGiftsDatabase() {
    try {
        if (fs.existsSync(GIFTS_DB_PATH)) {
            const raw = fs.readFileSync(GIFTS_DB_PATH, 'utf8');
            const database = JSON.parse(raw);

            Object.values(database).forEach(gift => {
                receivedGifts.set(gift.name, {
                    id: gift.id || null,
                    name: gift.name,
                    diamondCount: gift.diamondCount || 0,
                    imageUrl: gift.imageUrl || '',
                    localImage: gift.localImage || null
                });
            });

            console.log(`[GIFTS DB] ✅ ${Object.keys(database).length} regalos cargados desde la BD`);
            return database;
        } else {
            console.log('[GIFTS DB] No existe BD de regalos aún. Se creará cuando lleguen regalos.');
        }
    } catch (err) {
        console.error('[GIFTS DB] Error cargando BD:', err.message);
    }
    return {};
}

/**
 * Descarga la imagen del regalo de TikTok y la guarda en gifts/images/
 */
async function downloadGiftImage(imageUrl, giftName) {
    return new Promise((resolve) => {
        if (!imageUrl || !imageUrl.startsWith('http')) return resolve(null);

        if (!fs.existsSync(GIFTS_IMG_DIR)) {
            fs.mkdirSync(GIFTS_IMG_DIR, { recursive: true });
        }

        // Crear nombre de archivo limpio
        let ext = '.png';
        try {
            const parsed = new URL(imageUrl);
            const pathExt = path.extname(parsed.pathname);
            if (pathExt) ext = pathExt;
        } catch { }

        const safeName = giftName.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const filename = `${safeName}${ext}`;
        const filepath = path.join(GIFTS_IMG_DIR, filename);

        // Si ya existe, no descargar de nuevo
        if (fs.existsSync(filepath)) {
            return resolve(`/gifts/images/${filename}`);
        }

        const file = fs.createWriteStream(filepath);
        const protocol = imageUrl.startsWith('https') ? https : require('http');

        protocol.get(imageUrl, (response) => {
            if (response.statusCode === 200) {
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    console.log(`[GIFTS IMG] 📥 Descargada imagen: ${filename}`);
                    resolve(`/gifts/images/${filename}`);
                });
            } else {
                file.close();
                fs.unlink(filepath, () => { });
                resolve(null);
            }
        }).on('error', (err) => {
            fs.unlink(filepath, () => { });
            console.error(`[GIFTS IMG] Error descargando ${filename}:`, err.message);
            resolve(null);
        });
    });
}

/**
 * Guarda un regalo nuevo en la BD JSON y descarga su imagen
 */
async function saveGiftToDatabase(giftData) {
    try {
        let database = {};
        if (fs.existsSync(GIFTS_DB_PATH)) {
            const raw = fs.readFileSync(GIFTS_DB_PATH, 'utf8');
            database = JSON.parse(raw);
        }

        // Si ya existe, solo actualizar si le falta imagen
        if (database[giftData.name]) {
            const existing = database[giftData.name];
            if (!existing.localImage && giftData.imageUrl) {
                const localPath = await downloadGiftImage(giftData.imageUrl, giftData.name);
                if (localPath) {
                    existing.localImage = localPath;
                    fs.writeFileSync(GIFTS_DB_PATH, JSON.stringify(database, null, 2), 'utf8');
                    // Actualizar en memoria
                    const inMem = receivedGifts.get(giftData.name);
                    if (inMem) inMem.localImage = localPath;
                }
            }
            return;
        }

        // Descargar imagen del regalo
        const localImage = await downloadGiftImage(giftData.imageUrl, giftData.name);

        // Agregar a la BD
        database[giftData.name] = {
            name: giftData.name,
            id: giftData.id || null,
            diamondCount: giftData.diamondCount || 0,
            imageUrl: giftData.imageUrl || '',
            localImage: localImage,
            firstReceived: new Date().toISOString()
        };

        fs.writeFileSync(GIFTS_DB_PATH, JSON.stringify(database, null, 2), 'utf8');
        console.log(`[GIFTS DB] 💾 Guardado nuevo regalo: ${giftData.name} (${giftData.diamondCount} 💎)`);

        // Actualizar en memoria
        receivedGifts.set(giftData.name, {
            id: giftData.id || null,
            name: giftData.name,
            diamondCount: giftData.diamondCount || 0,
            imageUrl: localImage || giftData.imageUrl,
            localImage: localImage
        });
    } catch (err) {
        console.error('[GIFTS DB] Error guardando regalo:', err.message);
    }
}

// ─── GESTIÓN DE SESIONES TikTok ───────────────────────────────────────────────
// socketId -> { connector, username, isConnected, sessionKey }
const sessions = new Map();

/**
 * Conecta a TikTok Live para una sesión de Socket.IO
 */
async function connectToTikTok(socketId, username) {
    // Desconectar sesión previa si existe
    if (sessions.has(socketId)) {
        const old = sessions.get(socketId);
        if (old.connector) {
            try { old.connector.disconnect(); } catch { }
        }
    }

    const session = {
        connector: null,
        username: username,
        isConnected: false
    };
    sessions.set(socketId, session);

    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return;

    const baseConfig = {
        processInitialData: true,
        enableExtendedGiftInfo: false,
        webClientHeaders: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Referer': 'https://www.tiktok.com/',
        },
        webClientOptions: { timeout: 15000 },
        wsClientOptions: { timeout: 15000 },
    };

    const attemptConnect = async (cfg) => {
        const connector = new TikTokLiveConnection(username, cfg);
        const roomState = await connector.connect();
        return { connector, roomState };
    };

    try {
        // Intento 1: Conexión nativa (no consume límites de Euler)
        console.log(`[TikTok] 🔗 Conectando a @${username} (nativo)...`);
        const { connector, roomState } = await attemptConnect({ ...baseConfig, connectWithUniqueId: false });
        session.connector = connector;
        session.isConnected = true;

        onConnected(socketId, username, connector, roomState);
        return;
    } catch (err) {
        console.log(`[TikTok] ⚠️  Fallo nativo: ${err.message}`);

        // Intento 2: Euler Stream API (fallback, solo si hay clave)
        if (process.env.EULER_API_KEY) {
            try {
                console.log(`[TikTok] 🔄 Reintentando con Euler Stream...`);
                const { connector, roomState } = await attemptConnect({
                    ...baseConfig,
                    connectWithUniqueId: false,
                    signApiKey: process.env.EULER_API_KEY
                });
                session.connector = connector;
                session.isConnected = true;

                onConnected(socketId, username, connector, roomState);
                return;
            } catch (eulerErr) {
                console.error(`[TikTok] ❌ Fallo Euler: ${eulerErr.message}`);
                emitError(socket, username, eulerErr.message);
            }
        } else {
            emitError(socket, username, err.message);
        }
    }
}

function emitError(socket, username, errMsg) {
    let friendlyMsg = errMsg;
    if (errMsg.includes('Unexpected server response') || errMsg.includes('200') || errMsg.includes('room_id')) {
        friendlyMsg = `@${username} no está en LIVE o el usuario no existe`;
    } else if (errMsg.includes('captcha') || errMsg.includes('blocked')) {
        friendlyMsg = 'TikTok bloqueó la conexión. Agrega tu Session ID en el .env para solucionarlo.';
    }

    socket.emit('tiktok:status', { connected: false, error: { info: friendlyMsg } });
    socket.emit('tiktok:connect:response', { connected: false, error: { info: friendlyMsg } });
    console.log(`[TikTok] ❌ Error para @${username}: ${friendlyMsg}`);
}

function onConnected(socketId, username, connector, roomState) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return;

    console.log(`[TikTok] 🟢 Conectado a @${username}`);

    socket.emit('tiktok:status', {
        connected: true,
        username,
        viewers: roomState?.roomInfo?.stats?.viewerCount || 0
    });
    socket.emit('tiktok:connect:response', {
        connected: true,
        username,
        message: `Conectado a @${username} ✅`
    });

    // Eventos del Live
    connector.on('gift', (data) => {
        const safeUser = data.user || data.userDetails || {};
        const safeUniqueId = data.uniqueId || safeUser.uniqueId || safeUser.displayId || 'unknown';
        const safeNickname = data.nickname || safeUser.nickname || safeUniqueId;
        const safeGiftDetails = data.giftDetails || data.gift || {};

        const giftName = data.giftName || safeGiftDetails.giftName || 'Unknown Gift';
        const giftId = data.giftId || safeGiftDetails.id || 0;
        const diamondCount = data.diamondCount || safeGiftDetails.diamondCount || 0;

        const giftImage = data.giftPictureUrl ||
            (safeGiftDetails.giftImage?.url?.[0]) ||
            (safeGiftDetails.icon?.url?.[0]) ||
            data.extendedGiftInfo?.icon?.url_list?.[0] ||
            data.gift?.icon?.url_list?.[0] ||
            data.gift?.image?.url_list?.[0] || '';

        // Guardar/actualizar en BD de regalos
        saveGiftToDatabase({
            name: giftName,
            id: giftId,
            diamondCount,
            imageUrl: giftImage
        });

        // Emitir evento al frontend del juego de países
        socket.emit('tiktok:gift', {
            giftId,
            giftName,
            diamonds: diamondCount,
            repeatCount: data.repeatCount || 1,
            repeatEnd: !!data.repeatEnd,
            user: {
                id: safeUniqueId,
                name: safeNickname
            },
            giftPictureUrl: giftImage
        });

        console.log(`[Gift] 🎁 ${safeNickname} → ${giftName} (${diamondCount}💎 × ${data.repeatCount || 1})`);
    });

    connector.on('streamEnd', () => {
        console.log(`[TikTok] 🔴 Stream de @${username} terminó`);
        if (socket) socket.emit('tiktok:status', { connected: false, message: 'Stream finalizado' });
        const session = sessions.get(socketId);
        if (session) session.isConnected = false;
    });

    connector.on('disconnected', () => {
        console.log(`[TikTok] 🔴 Desconectado de @${username}`);
        if (socket) socket.emit('tiktok:status', { connected: false });
        const session = sessions.get(socketId);
        if (session) session.isConnected = false;
    });

    connector.on('disconnect', () => {
        const session = sessions.get(socketId);
        if (session) session.isConnected = false;
        if (socket) socket.emit('tiktok:status', { connected: false });
    });

    connector.on('error', (err) => {
        const msg = err?.message || 'Error de conexión TikTok';
        console.error(`[TikTok] Error:`, msg);
        if (socket) socket.emit('tiktok:status', { connected: false, error: { info: msg } });
        const session = sessions.get(socketId);
        if (session) session.isConnected = false;
    });

    connector.on('member', (data) => {
        const viewers = data.viewerCount || 0;
        const session = sessions.get(socketId);
        if (session) session.viewers = viewers;
    });
}

// ─── SOCKET.IO — EVENTOS DEL CLIENTE ─────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`[WS] ✅ Cliente conectado: ${socket.id}`);

    // El cliente pide conectar a TikTok
    socket.on('tiktok:connect', async ({ username } = {}) => {
        if (!username) {
            socket.emit('tiktok:connect:response', { connected: false, error: { info: 'Username requerido' } });
            return;
        }

        const cleanUsername = username.trim().replace('@', '');
        console.log(`[WS] 📡 Solicitud de conexión para @${cleanUsername}`);

        socket.emit('tiktok:connect:response', {
            connecting: true,
            message: `🟡 Conectando a @${cleanUsername}...`
        });

        await connectToTikTok(socket.id, cleanUsername);
    });

    // Desconectar de TikTok
    socket.on('tiktok:disconnect', () => {
        const session = sessions.get(socket.id);
        if (session?.connector) {
            try { session.connector.disconnect(); } catch { }
        }
        sessions.delete(socket.id);
        console.log(`[WS] 🔌 Desconexión manual: ${socket.id}`);
    });

    socket.on('disconnect', () => {
        const session = sessions.get(socket.id);
        if (session?.connector) {
            try { session.connector.disconnect(); } catch { }
        }
        sessions.delete(socket.id);
        console.log(`[WS] 🔴 Cliente desconectado: ${socket.id}`);
    });
});

// ─── API REST ─────────────────────────────────────────────────────────────────

/**
 * GET /api/gifts — Lista de regalos en memoria (regalos vivos recibidos en la sesión)
 * Devuelve formato compatible con el frontend del juego de países
 */
app.get('/api/gifts', (req, res) => {
    const gifts = Array.from(receivedGifts.values())
        .map(g => ({
            giftId: g.id,
            name: g.name,
            diamonds: g.diamondCount,
            image: g.localImage || g.imageUrl || ''
        }))
        .filter(g => g.giftId)
        .sort((a, b) => a.diamonds - b.diamonds);

    res.json(gifts);
});

/**
 * GET /api/gifts/database — Regalos desde la BD persistente (archivo JSON)
 * Incluye todos los regalos que alguna vez se han recibido
 */
app.get('/api/gifts/database', (req, res) => {
    try {
        if (fs.existsSync(GIFTS_DB_PATH)) {
            const raw = fs.readFileSync(GIFTS_DB_PATH, 'utf8');
            const database = JSON.parse(raw);

            const gifts = Object.values(database)
                .map(g => ({
                    giftId: g.id,
                    name: g.name,
                    diamonds: g.diamondCount,
                    image: g.localImage ? `http://localhost:${PORT}${g.localImage}` : g.imageUrl || '',
                    imageUrl: g.imageUrl || '',
                    localImage: g.localImage || null,
                    firstReceived: g.firstReceived || null
                }))
                .filter(g => g.giftId)
                .sort((a, b) => a.diamonds - b.diamonds);

            res.json({ success: true, total: gifts.length, gifts });
        } else {
            res.json({ success: true, total: 0, gifts: [] });
        }
    } catch (err) {
        console.error('[API] Error leyendo BD de regalos:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/status — Estado del servidor
 */
app.get('/api/status', (req, res) => {
    const activeSessions = Array.from(sessions.entries())
        .filter(([, s]) => s.isConnected)
        .map(([id, s]) => ({ socketId: id.substring(0, 8) + '...', username: s.username }));

    res.json({
        success: true,
        server: 'PAISES Race Game Server v1.0',
        port: PORT,
        giftsInDB: receivedGifts.size,
        activeSessions: activeSessions.length,
        sessions: activeSessions
    });
});

/**
 * POST /api/gifts/download — Descarga manualmente las imágenes de todos los regalos en la BD
 */
app.post('/api/gifts/download-images', async (req, res) => {
    try {
        if (!fs.existsSync(GIFTS_DB_PATH)) {
            return res.json({ success: false, message: 'No hay BD de regalos aún' });
        }

        const raw = fs.readFileSync(GIFTS_DB_PATH, 'utf8');
        const database = JSON.parse(raw);
        const entries = Object.values(database);

        let downloaded = 0;
        let skipped = 0;

        for (const gift of entries) {
            if (!gift.localImage && gift.imageUrl) {
                const localPath = await downloadGiftImage(gift.imageUrl, gift.name);
                if (localPath) {
                    gift.localImage = localPath;
                    downloaded++;
                }
            } else {
                skipped++;
            }
        }

        // Guardar la BD actualizada
        const updatedDB = {};
        entries.forEach(g => { updatedDB[g.name] = g; });
        fs.writeFileSync(GIFTS_DB_PATH, JSON.stringify(updatedDB, null, 2), 'utf8');

        res.json({ success: true, downloaded, skipped, total: entries.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── ARRANCAR SERVIDOR ────────────────────────────────────────────────────────
loadGiftsDatabase();

server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║   🌎 PAISES Race Game Server — Servidor Propio  ║');
    console.log(`║   🚀 Corriendo en: http://localhost:${PORT}          ║`);
    console.log('║   🎮 Juego: http://localhost:' + PORT + '/               ║');
    console.log('║   🎁 API Regalos: http://localhost:' + PORT + '/api/gifts║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
});

