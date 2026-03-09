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
 * Guarda un regalo nuevo en la BD JSON y emite actualización si es nuevo
 */
async function saveGiftToDatabase(giftData) {
    try {
        let database = {};
        if (fs.existsSync(GIFTS_DB_PATH)) {
            const raw = fs.readFileSync(GIFTS_DB_PATH, 'utf8');
            database = JSON.parse(raw);
        }

        const isNew = !database[giftData.name];

        // Si ya existe, actualizar URL si tiene imagen nueva
        if (!isNew) {
            const existing = database[giftData.name];
            // Actualizar id si era null
            if (!existing.id && giftData.id) {
                existing.id = giftData.id;
            }
            // Actualizar imageUrl si es nueva (las de TikTok expiran)
            if (giftData.imageUrl && giftData.imageUrl.startsWith('http')) {
                existing.imageUrl = giftData.imageUrl;
                // Actualizar en memoria
                const inMem = receivedGifts.get(giftData.name);
                if (inMem) {
                    inMem.imageUrl = giftData.imageUrl;
                    if (giftData.id) inMem.id = giftData.id;
                }
            }
            // Intentar descargar imagen si no hay local
            if (!existing.localImage && giftData.imageUrl) {
                const localPath = await downloadGiftImage(giftData.imageUrl, giftData.name);
                if (localPath) {
                    existing.localImage = localPath;
                    const inMem = receivedGifts.get(giftData.name);
                    if (inMem) inMem.localImage = localPath;
                }
            }
            fs.writeFileSync(GIFTS_DB_PATH, JSON.stringify(database, null, 2), 'utf8');
            return;
        }

        // Regalo nuevo: descargar imagen
        const localImage = await downloadGiftImage(giftData.imageUrl, giftData.name);

        database[giftData.name] = {
            name: giftData.name,
            id: giftData.id || null,
            diamondCount: giftData.diamondCount || 0,
            imageUrl: giftData.imageUrl || '',    // Siempre guardar URL original
            localImage: localImage || null,
            firstReceived: new Date().toISOString()
        };

        fs.writeFileSync(GIFTS_DB_PATH, JSON.stringify(database, null, 2), 'utf8');
        console.log(`[GIFTS DB] 💾 Nuevo regalo: ${giftData.name} (ID:${giftData.id}, ${giftData.diamondCount}💎)`);

        // Actualizar en memoria
        const memEntry = {
            id: giftData.id || null,
            name: giftData.name,
            diamondCount: giftData.diamondCount || 0,
            imageUrl: giftData.imageUrl || '',    // Guardar URL original siempre
            localImage: localImage || null
        };
        receivedGifts.set(giftData.name, memEntry);

        // Notificar a todos los clientes que hay un nuevo regalo en la biblioteca
        const BACKEND_BASE = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
        const imageForFrontend = localImage ? `${BACKEND_BASE}${localImage}` : giftData.imageUrl || '';

        io.emit('library:newGift', {
            giftId: giftData.id,
            name: giftData.name,
            diamonds: giftData.diamondCount || 0,
            image: imageForFrontend
        });

    } catch (err) {
        console.error('[GIFTS DB] Error guardando regalo:', err.message);
    }
}

// ─── SESIÓN GLOBAL PERSISTENTE DE TIKTOK ────────────────────────────────────
// Una sola sesión compartida por TODOS los clientes
const globalSession = {
    connector: null,
    username: null,
    isConnected: false,
    reconnectTimer: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 10,
    stopping: false // true cuando el usuario pide desconectar manualmente
};

const BASE_CONFIG = {
    processInitialData: true,
    enableExtendedGiftInfo: false,
    webClientHeaders: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Referer': 'https://www.tiktok.com/',
    },
    webClientOptions: { timeout: 20000 },
    wsClientOptions: { timeout: 20000 },
};

/**
 * Emite un evento a TODOS los clientes Socket.IO conectados
 */
function broadcastToAll(event, data) {
    io.emit(event, data);
}

/**
 * Calcula el delay de reconexión con backoff exponencial (máx 30 segundos)
 */
function getReconnectDelay(attempts) {
    return Math.min(1000 * Math.pow(2, attempts), 30000);
}

/**
 * Detiene la sesión actual de TikTok
 */
function stopTikTokSession() {
    if (globalSession.reconnectTimer) {
        clearTimeout(globalSession.reconnectTimer);
        globalSession.reconnectTimer = null;
    }
    if (globalSession.connector) {
        try { globalSession.connector.disconnect(); } catch { }
        globalSession.connector = null;
    }
    globalSession.isConnected = false;
}

/**
 * Conecta a TikTok Live de forma persistente y se auto-reconecta si se cae
 */
async function connectToTikTokPersistent(username, manual = false) {
    if (manual) {
        globalSession.stopping = false;
        globalSession.reconnectAttempts = 0;
    }

    // Si ya estamos conectados al mismo usuario, no hacer nada
    if (globalSession.isConnected && globalSession.username === username) {
        console.log(`[TikTok] ℹ️ Ya conectado a @${username}`);
        return;
    }

    // Detener sesión anterior
    stopTikTokSession();
    globalSession.username = username;

    console.log(`[TikTok] 🔗 Conectando a @${username} (intento ${globalSession.reconnectAttempts + 1})...`);
    broadcastToAll('tiktok:status', { connecting: true, username, message: `🟡 Conectando a @${username}...` });

    const tryConnect = async (cfg) => {
        const connector = new TikTokLiveConnection(username, cfg);
        const roomState = await connector.connect();
        return { connector, roomState };
    };

    let connector = null;
    let roomState = null;

    try {
        // Intento nativo
        const result = await tryConnect({ ...BASE_CONFIG, connectWithUniqueId: false });
        connector = result.connector;
        roomState = result.roomState;
    } catch (err1) {
        console.log(`[TikTok] ⚠️  Fallo nativo: ${err1.message}`);

        if (process.env.EULER_API_KEY) {
            try {
                const result = await tryConnect({ ...BASE_CONFIG, connectWithUniqueId: false, signApiKey: process.env.EULER_API_KEY });
                connector = result.connector;
                roomState = result.roomState;
            } catch (err2) {
                console.error(`[TikTok] ❌ Fallo Euler: ${err2.message}`);
                scheduleReconnect(username);
                return;
            }
        } else {
            scheduleReconnect(username);
            return;
        }
    }

    // Éxito
    globalSession.connector = connector;
    globalSession.isConnected = true;
    globalSession.reconnectAttempts = 0;

    const viewers = roomState?.roomInfo?.stats?.viewerCount || 0;
    console.log(`[TikTok] 🟢 Conectado a @${username} (${viewers} espectadores)`);
    broadcastToAll('tiktok:status', { connected: true, username, viewers });
    broadcastToAll('tiktok:connect:response', { connected: true, username, message: `Conectado a @${username} ✅` });

    // ─── Eventos del Live ────────────────────────────────────────────────────
    connector.on('gift', (data) => {
        const safeUser = data.user || data.userDetails || {};
        const safeUniqueId = data.uniqueId || safeUser.uniqueId || safeUser.displayId || 'unknown';
        const safeNickname = data.nickname || safeUser.nickname || safeUniqueId;
        const safeGiftDetails = data.giftDetails || data.gift || {};

        const giftName  = data.giftName  || safeGiftDetails.giftName  || 'Unknown Gift';
        const giftId    = data.giftId    || safeGiftDetails.id        || 0;
        const diamondCount = data.diamondCount || safeGiftDetails.diamondCount || 0;
        const giftImage = data.giftPictureUrl ||
            (safeGiftDetails.giftImage?.url?.[0]) ||
            (safeGiftDetails.icon?.url?.[0]) ||
            data.extendedGiftInfo?.icon?.url_list?.[0] ||
            data.gift?.icon?.url_list?.[0] ||
            data.gift?.image?.url_list?.[0] || '';

        saveGiftToDatabase({ name: giftName, id: giftId, diamondCount, imageUrl: giftImage });

        // Emitir a TODOS los clientes
        broadcastToAll('tiktok:gift', {
            giftId,
            giftName,
            diamonds: diamondCount,
            repeatCount: data.repeatCount || 1,
            repeatEnd: !!data.repeatEnd,
            user: { id: safeUniqueId, name: safeNickname },
            giftPictureUrl: giftImage
        });

        console.log(`[Gift] 🎁 ${safeNickname} → ${giftName} (${diamondCount}💎 × ${data.repeatCount || 1})`);
    });

    connector.on('streamEnd', () => {
        console.log(`[TikTok] 🔴 Stream de @${username} terminó`);
        globalSession.isConnected = false;
        broadcastToAll('tiktok:status', { connected: false, message: 'Stream finalizado' });
        if (!globalSession.stopping) scheduleReconnect(username);
    });

    connector.on('disconnected', () => {
        console.log(`[TikTok] 🔴 Desconectado de @${username}`);
        globalSession.isConnected = false;
        broadcastToAll('tiktok:status', { connected: false });
        if (!globalSession.stopping) scheduleReconnect(username);
    });

    connector.on('disconnect', () => {
        globalSession.isConnected = false;
        broadcastToAll('tiktok:status', { connected: false });
        if (!globalSession.stopping) scheduleReconnect(username);
    });

    connector.on('error', (err) => {
        const msg = err?.message || 'Error de conexión TikTok';
        console.error(`[TikTok] Error:`, msg);
        globalSession.isConnected = false;
        broadcastToAll('tiktok:status', { connected: false, error: { info: msg } });
        if (!globalSession.stopping) scheduleReconnect(username);
    });

    connector.on('member', (data) => {
        const viewers = data.viewerCount || 0;
        // No es necesario guardarlo en globalSession pero podemos hacer broadcast
        broadcastToAll('tiktok:viewers', { viewers });
    });
}

/**
 * Programa un intento de reconexion con backoff exponencial
 */
function scheduleReconnect(username) {
    if (globalSession.stopping) return;
    if (globalSession.reconnectAttempts >= globalSession.maxReconnectAttempts) {
        console.error(`[TikTok] ❌ Máximo de intentos alcanzado (${globalSession.maxReconnectAttempts}). Deteniendo auto-reconexion.`);
        broadcastToAll('tiktok:status', { connected: false, error: { info: 'No se pudo reconectar. Presiona Reconectar manualmente.' } });
        return;
    }

    globalSession.reconnectAttempts++;
    const delay = getReconnectDelay(globalSession.reconnectAttempts);
    console.log(`[TikTok] 🔄 Reconectando a @${username} en ${delay / 1000}s (intento ${globalSession.reconnectAttempts}/${globalSession.maxReconnectAttempts})...`);
    broadcastToAll('tiktok:status', {
        connected: false,
        reconnecting: true,
        message: `🟡 Reconectando a @${username} en ${Math.ceil(delay / 1000)}s (intento ${globalSession.reconnectAttempts})...`
    });

    globalSession.reconnectTimer = setTimeout(() => {
        connectToTikTokPersistent(username, false);
    }, delay);
}

// ─── SOCKET.IO — EVENTOS DEL CLIENTE ─────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`[WS] ✅ Cliente conectado: ${socket.id}`);

    // Enviar estado actual al nuevo cliente
    if (globalSession.isConnected && globalSession.username) {
        socket.emit('tiktok:status', { connected: true, username: globalSession.username });
        socket.emit('tiktok:connect:response', { connected: true, username: globalSession.username, message: `Conectado a @${globalSession.username} ✅` });
    } else if (globalSession.username) {
        socket.emit('tiktok:status', { connected: false, reconnecting: true, message: `🟡 Reconectando a @${globalSession.username}...` });
    }

    // El cliente pide conectar a TikTok
    socket.on('tiktok:connect', async ({ username } = {}) => {
        if (!username) {
            socket.emit('tiktok:connect:response', { connected: false, error: { info: 'Username requerido' } });
            return;
        }

        const cleanUsername = username.trim().replace('@', '');
        console.log(`[WS] 📡 Solicitud de conexión para @${cleanUsername}`);

        socket.emit('tiktok:connect:response', { connecting: true, message: `🟡 Conectando a @${cleanUsername}...` });
        await connectToTikTokPersistent(cleanUsername, true);
    });

    // Desconectar de TikTok (manual)
    socket.on('tiktok:disconnect', () => {
        console.log(`[WS] 🔌 Desconexión manual solicitada`);
        globalSession.stopping = true;
        stopTikTokSession();
        broadcastToAll('tiktok:status', { connected: false });
    });

    socket.on('disconnect', () => {
        console.log(`[WS] 🔴 Cliente desconectado: ${socket.id}`);
        // No afecta la sesión de TikTok - sigue corriendo para otros clientes
    });

    // Mantener la conexión viva en Render
    socket.on('ping', () => {
        socket.emit('pong');
    });

    // El cliente puede pedir el estado actual
    socket.on('tiktok:getStatus', () => {
        socket.emit('tiktok:status', {
            connected: globalSession.isConnected,
            username: globalSession.username
        });
    });
});

// ─── API REST ─────────────────────────────────────────────────────────────────

/**
 * GET /api/gifts — Regalos combinados: BD persistente + memoria (URLs frescas)
 * Persiste entre reinicios de Render leyendo el archivo JSON directamente.
 */
app.get('/api/gifts', (req, res) => {
    const BACKEND_BASE = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

    // Leer la BD del archivo (fuente de verdad persistente)
    let dbGifts = {};
    try {
        if (fs.existsSync(GIFTS_DB_PATH)) {
            const raw = fs.readFileSync(GIFTS_DB_PATH, 'utf8');
            dbGifts = JSON.parse(raw);
        }
    } catch (e) {
        console.error('[API] Error leyendo DB regalos:', e.message);
    }

    // Mezclar archivo + memoria (memoria tiene imageUrls más recientes de TikTok)
    const merged = new Map();
    Object.values(dbGifts).forEach(g => { if (g.name) merged.set(g.name, g); });
    receivedGifts.forEach((g, name) => { merged.set(name, { ...(merged.get(name) || {}), ...g }); });

    const gifts = Array.from(merged.values())
        .filter(g => g.id && g.id !== 0)
        .map(g => {
            let image = '';
            if (g.localImage) {
                image = g.localImage.startsWith('http') ? g.localImage : `${BACKEND_BASE}${g.localImage}`;
            } else if (g.imageUrl) {
                image = g.imageUrl;
            }
            return { giftId: g.id, name: g.name, diamonds: g.diamondCount || 0, image };
        })
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

