

    // Array de regalos (se carga desde URL externa)
    let gifts = [];

    // URL para cargar regalos - DINÁMICA para producción
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    // --- CONFIGURACIÓN DE DESPLIEGUE ---
    const RENDER_URL = 'https://apipais.samyflw.com'; // URL de backend seguro en VPS con subdominio unico en raiz
    // ----------------------------------

    const SERVER_BASE_URL = isLocal ? 'http://localhost:3001' : (window.location.origin.includes('onrender') ? window.location.origin : RENDER_URL);
    const GIFTS_URL = `${SERVER_BASE_URL}/api/gifts`;

    // ─── CACHÉ LOCAL DE REGALOS (sobrevive reinicios de Render) ──────────────────────
    // Render tiene filesystem efímero: gifts_database.json se borra en cada reinicio.
    // Guardamos los regalos en localStorage del navegador para que no desaparezcan.
    const LOCAL_GIFTS_KEY = 'giftsLocalCache_v2';

    function saveGiftsToLocalCache(giftsArray) {
      try {
        const toSave = giftsArray.map(g => ({
          giftId: g.giftId,
          name: g.name,
          diamonds: g.diamonds,
          image: g.image
        }));
        localStorage.setItem(LOCAL_GIFTS_KEY, JSON.stringify(toSave));
      } catch(e) { console.warn('No se pudo guardar caché de regalos:', e); }
    }

    function loadGiftsFromLocalCache() {
      try {
        const raw = localStorage.getItem(LOCAL_GIFTS_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch(e) { return []; }
    }

    // Cargar regalos desde URL externa
    async function loadGifts() {
      try {
        console.log('📦 Cargando regalos desde:', GIFTS_URL);
        const response = await fetch(GIFTS_URL);

        if (!response.ok) {
          throw new Error(`Error HTTP: ${response.status}`);
        }

        const data = await response.json();

        // Validar que sea un array
        if (Array.isArray(data)) {
          gifts = data.map(gift => {
            const cleanedId = cleanGiftId(gift.giftId);
            let imgUrl = gift.image || '';
            if (imgUrl.startsWith('/')) imgUrl = SERVER_BASE_URL + imgUrl;
            return { ...gift, giftId: cleanedId !== null ? cleanedId : gift.giftId, image: imgUrl };
          });

          // ─── MERGE con caché local ───────────────────────────────────────────────
          // Los regalos en el caché local que NO estén en el servidor (fueron borrados
          // por el reinicio efímero de Render) los volvemos a agregar al array.
          const localCached = loadGiftsFromLocalCache();
          let mergedCount = 0;
          localCached.forEach(cached => {
            const cachedId = cleanGiftId(cached.giftId);
            if (cachedId === null) return;
            const alreadyInServer = gifts.some(g => cleanGiftId(g.giftId) === cachedId);
            if (!alreadyInServer) {
              gifts.push(cached);
              mergedCount++;
            }
          });
          if (mergedCount > 0) {
            console.log(`💾 Restaurados ${mergedCount} regalos desde caché local (Render reinició)`);
          }

          // Actualizar el caché local con la lista completa actual
          saveGiftsToLocalCache(gifts);

          console.log(`✅ ${gifts.length} regalos totales (${data.length} servidor + ${mergedCount} local)`);

          if (document.getElementById('countryGiftConfig')) renderGiftConfig();
          if (document.getElementById('specialGiftDropdown')) renderSpecialGiftDropdown();
          updateSpecialGiftSelector();
          return true;
        } else {
          throw new Error('Los datos recibidos no son un array válido');
        }
      } catch (error) {
        console.error('❌ Error cargando regalos:', error);

        // Mostrar mensaje de error al usuario
        const configModal = document.getElementById('configModal');
        if (configModal && configModal.style.display !== 'none') {
          const errorMsg = document.createElement('div');
          errorMsg.style.cssText = 'background:rgba(239,68,68,.2);border:2px solid rgba(239,68,68,.6);border-radius:12px;padding:1rem;margin:1rem 0;text-align:center;';
          errorMsg.innerHTML = `
        <div style="color:#ef4444;font-weight:700;margin-bottom:0.5rem;">⚠️ Error cargando regalos</div>
        <div style="font-size:0.85rem;opacity:0.8;">No se pudieron cargar los regalos desde ${GIFTS_URL}</div>
        <div style="font-size:0.75rem;opacity:0.6;margin-top:0.5rem;">${error.message}</div>
      `;

          // Insertar antes del botón de iniciar juego
          const startBtn = configModal.querySelector('button[onclick="startGame()"]');
          if (startBtn && !configModal.querySelector('.gifts-error')) {
            errorMsg.className = 'gifts-error';
            startBtn.parentNode.insertBefore(errorMsg, startBtn);
          }
        }

        return false;
      }
    }

    // Cargar regalos al iniciar
    loadGifts();



    // Países por defecto
    const defaultCountries = [
      { n: "Colombia", f: "co", c: "#3b82f6", v: 0, p: 420, gifts: [] },
      { n: "Puerto Rico", f: "pr", c: "#22c55e", v: 0, p: 260, gifts: [] },
      { n: "Mexico", f: "mx", c: "#16a34a", v: 0, p: 230, gifts: [] },
      { n: "República Dominicana", f: "do", c: "#16a34a", v: 0, p: 230, gifts: [] },
      { n: "Cuba", f: "cu", c: "#60a5fa", v: 0, p: 210, gifts: [] },
      { n: "Venezuela", f: "ve", c: "#dc2626", v: 0, p: 170, gifts: [] },
      { n: "Perú", f: "pe", c: "#ef4444", v: 0, p: 160, gifts: [] },
      { n: "Ecuador", f: "ec", c: "#fbbf24", v: 0, p: 155, gifts: [] },
      { n: "nicaragua", f: "ni", c: "#fbbf24", v: 0, p: 155, gifts: [] },
      { n: "honduras", f: "hn", c: "#fbbf24", v: 0, p: 155, gifts: [] },
      { n: "guatemala", f: "gt", c: "#fbbf24", v: 0, p: 155, gifts: [] },
      { n: "el salvador", f: "sv", c: "#fbbf24", v: 0, p: 155, gifts: [] }
    ];

    // Array de países (se carga desde localStorage o usa los valores por defecto)
    let countries = [];

    const WINS_STORAGE_KEY = 'countryWins';
    const AUTO_RESTART_DELAY = 5000;
    const SPECIAL_GIFT_ROTATION_TIME = 20000; // 20 segundos
    let winCounts = {};
    let restartTimeout = null;

    // Sistema de regalo especial
    let specialGift = null; // {giftId, name, image}
    let selectedSpecialGiftId = null; // ID del regalo especial seleccionado por el usuario
    let specialGiftCountryIndex = 0; // Índice del país que tiene el regalo especial
    let specialGiftRotationInterval = null;
    let specialGiftTimerInterval = null;
    let specialGiftTimeLeft = SPECIAL_GIFT_ROTATION_TIME;




    /*const countries = [
      {n:"Estados Unidos", f:"us", c:"#3b82f6", v:0, p:420, giftImg:"gifts/us.png"},
      {n:"Brasil",        f:"br", c:"#22c55e", v:0, p:260, giftImg:"gifts/br.png"},
      {n:"Canadá",        f:"ca", c:"#ef4444", v:0, p:240, giftImg:"gifts/ca.png"},
      {n:"México",        f:"mx", c:"#16a34a", v:0, p:230, giftImg:"gifts/mx.png"},
      {n:"Argentina",     f:"ar", c:"#60a5fa", v:0, p:210, giftImg:"gifts/ar.png"},
    
      {n:"Chile",         f:"cl", c:"#dc2626", v:0, p:170, giftImg:"gifts/cl.png"},
      {n:"Colombia",      f:"co", c:"#facc15", v:0, p:165, giftImg:"gifts/co.png"},
      {n:"Perú",          f:"pe", c:"#ef4444", v:0, p:160, giftImg:"gifts/pe.png"},
      {n:"Venezuela",     f:"ve", c:"#fbbf24", v:0, p:155, giftImg:"gifts/ve.png"},
      {n:"Ecuador",       f:"ec", c:"#fde047", v:0, p:150, giftImg:"gifts/ec.png"},
      {n:"Bolivia",       f:"bo", c:"#22c55e", v:0, p:145, giftImg:"gifts/bo.png"},
      {n:"Paraguay",      f:"py", c:"#fb7185", v:0, p:140, giftImg:"gifts/py.png"},
      {n:"Uruguay",       f:"uy", c:"#38bdf8", v:0, p:138, giftImg:"gifts/uy.png"},
    ];*/

    const track = document.getElementById("track");
    const goalEl = document.getElementById("goal");
    const finalModal = document.getElementById("finalModal");
    const configModal = document.getElementById("configModal");
    const gameContainer = document.getElementById("gameContainer");
    const countryGiftConfig = document.getElementById("countryGiftConfig");
    let loop = null;
    let MAX = 100000; // Meta configurable
    let gameStarted = false;

    const SOCKET_URL = SERVER_BASE_URL;
    let socket = null;
    let socketConnected = false;

    // ─── SISTEMA DE CHAT / COMENTARIOS ───────────────────────────────────────
    // Leer correctamente (null si no existe = activar por defecto)
    const _savedChat = localStorage.getItem('chatPointsEnabled');
    let chatPointsEnabled = _savedChat !== null ? JSON.parse(_savedChat) : true;
    let chatPointsPerComment = parseFloat(localStorage.getItem('chatPointsPerComment') ?? '0.1');
    const CHAT_COOLDOWN_MS = 2000;       // 2s de cooldown entre comentarios por usuario
    const chatUserCooldowns = new Map(); // userId -> lastTime (timestamp)

    // ─── SISTEMA DE DIFICULTAD ───────────────────────────────────────────────
    let difficultyEnabled    = JSON.parse(localStorage.getItem('difficultyEnabled') ?? 'false');
    let difficultyMultiplier = parseFloat(localStorage.getItem('difficultyMultiplier') ?? '1');

    // ─── REGALOS NUEVOS (badge 🆕) ──────────────────────────────────────────────
    // Guarda los IDs de regalos recibidos en vivo esta sesión (se limpia al asignarlos)
    const newGiftIds = new Set(
      JSON.parse(localStorage.getItem('newGiftIds') || '[]')
    );
    function saveNewGiftIds() {
      localStorage.setItem('newGiftIds', JSON.stringify([...newGiftIds]));
    }
    function markGiftAsUsed(giftId) {
      const cleaned = cleanGiftId(giftId);
      if (cleaned !== null && newGiftIds.has(cleaned)) {
        newGiftIds.delete(cleaned);
        saveNewGiftIds();
      }
    }

    console.log('🔌 Socket URL:', SOCKET_URL);

    // Timestamp de última actividad del socket (usado por el watchdog)
    let lastActivityTime = Date.now();

    // Conectar al servidor Socket.IO
    function connectSocket() {
      try {
        // Limpiar watchdog del socket anterior si existe
        if (socket) {
          try {
            if (socket._watchdogInterval) clearInterval(socket._watchdogInterval);
            socket.disconnect();
          } catch(e){}
        }

        socket = io(SOCKET_URL, {
          // IMPORTANTE: polling PRIMERO — funciona en TODAS las redes (móvil, Render proxy).
          // Socket.IO hará upgrade automático a WebSocket si la red lo permite.
          transports: ['polling', 'websocket'],
          // Reconexión automática ilimitada con backoff exponencial
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 10000,
          randomizationFactor: 0.5,
          timeout: 45000,
        });

        socket.on('connect', () => {
          console.log('🟢 Conectado al servidor Socket.IO');
          socketConnected = true;
          updateSocketStatus(true);
          // Pedir el estado actual de TikTok al servidor
          socket.emit('tiktok:getStatus');
        });

        socket.on('disconnect', (reason) => {
          console.log('🔴 Desconectado del servidor Socket.IO. Razón:', reason);
          socketConnected = false;
          updateSocketStatus(false);
          // Si el servidor nos desconectó (no fue proactivo desde el cliente),
          // Socket.IO auto-reconectará automáticamente gracias a reconnection:true
        });

        socket.on('connect_error', (error) => {
          console.error('❌ Error de conexión Socket.IO:', error.message);
          socketConnected = false;
          updateSocketStatus(false);
        });

        socket.on('reconnect', (attemptNumber) => {
          console.log(`🔄 Reconectado al servidor (intento #${attemptNumber})`);
          // Al reconectar, volver a solicitar estado de TikTok
          const savedUser = localStorage.getItem('tiktokUsername');
          if (savedUser && socket.tiktokUsername) {
            socket.emit('tiktok:connect', { username: socket.tiktokUsername });
          }
        });

        socket.on('reconnect_attempt', (attemptNumber) => {
          console.log(`🔁 Reintentando conexión... intento #${attemptNumber}`);
        });

        // Keepalive del servidor: actualizar timestamp al recibirlo
        socket.on('keepalive', () => { lastActivityTime = Date.now(); });

        // ─────────────────────────────────────────────────────────────
        // WATCHDOG: detecta socket zombie (connected=true pero sin datos)
        // ─────────────────────────────────────────────────────────────
        socket.on('pong', () => { lastActivityTime = Date.now(); });

        // Solo registrar el watchdog y visibilitychange la PRIMERA VEZ
        // (evita listeners duplicados cuando connectSocket() se llama varias veces)
        if (!window._socketWatchdogRegistered) {
          window._socketWatchdogRegistered = true;

          setInterval(() => {
            if (!socket || !socket.connected) return;
            const elapsed = Date.now() - lastActivityTime;
            if (elapsed > 55000) {
              console.warn(`⚠️ WATCHDOG: Sin actividad por ${Math.round(elapsed/1000)}s. Reconectando...`);
              socket.disconnect();
              setTimeout(() => { if (socket) socket.connect(); }, 500);
              lastActivityTime = Date.now();
            }
          }, 25000);

          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
              setTimeout(() => {
                if (!socket || !socket.connected) {
                  console.log('📡 [VISIBILITY] Volvió al navegador. Reconectando...');
                  if (socket) { socket.connect(); } else { connectSocket(); }
                } else {
                  socket.emit('tiktok:getStatus');
                }
                lastActivityTime = Date.now();
              }, 500);
            }
          });
        }

        // Escuchar regalos de TikTok
        socket.on('tiktok:gift', (giftData) => {
          lastActivityTime = Date.now();
          handleGiftReceived(giftData);
        });

        // Escuchar comentarios de TikTok → puntos por chat
        socket.on('tiktok:chat', (chatData) => {
          lastActivityTime = Date.now();
          if (chatPointsEnabled && gameStarted) {
            handleChatComment(chatData);
          }
        });

        // Escuchar estado de conexión de TikTok
        socket.on('tiktok:status', (status) => {
          lastActivityTime = Date.now();
          updateTikTokStatus(status);
          updateTikTokConnectionStatus(status);
        });

        // Escuchar respuesta de conexión a TikTok
        socket.on('tiktok:connect:response', (response) => {
          updateTikTokConnectionStatus(response);
        });

        // 🆕 Regalo nuevo del live: añadir a biblioteca Y guardar en localStorage
        socket.on('library:newGift', (gift) => {
          if (!gift || !gift.giftId) return;
          const alreadyExists = gifts.some(g => String(g.giftId) === String(gift.giftId));
          if (!alreadyExists) {
            if (gift.image && gift.image.startsWith('/')) gift.image = SERVER_BASE_URL + gift.image;
            gifts.push(gift);
            // Persistir en localStorage para sobrevivir reinicios de Render
            saveGiftsToLocalCache(gifts);
            // Marcar como nuevo
            const cleanedId = cleanGiftId(gift.giftId);
            if (cleanedId !== null) { newGiftIds.add(cleanedId); saveNewGiftIds(); }
            console.log(`📚 🆕 Nuevo regalo (guardado localmente): ${gift.name} (💎${gift.diamonds})`);
          } else {
            const existing = gifts.find(g => String(g.giftId) === String(gift.giftId));
            if (existing && gift.image) {
              existing.image = gift.image;
              saveGiftsToLocalCache(gifts); // actualizar imagen en caché
            }
          }
          const configVisible = document.getElementById('configModal')?.style.display !== 'none';
          if (configVisible) { updateAllDropdowns(); renderSpecialGiftDropdown(); }
        });

      } catch (error) {
        console.error('❌ Error al inicializar Socket.IO:', error);
        socketConnected = false;
        updateSocketStatus(false);
      }
    }

    // Actualizar estado de conexión en la UI
    function updateSocketStatus(connected) {
      const statusContainer = document.getElementById('socketStatus');
      const statusEl = document.getElementById('socketStatusText');

      if (!statusContainer || !statusEl) return;

      // Limpiar botón de recargar si existe
      const existingBtn = statusContainer.querySelector('.reload-socket-btn');
      if (existingBtn) existingBtn.remove();

      if (connected) {
        statusEl.textContent = '🟢 Socket conectado';
        statusEl.style.color = '#22c55e';
      } else {
        statusEl.textContent = '🔴 Socket desconectado';
        statusEl.style.color = '#ef4444';

        // Agregar botón de recargar cuando está desconectado
        const reloadBtn = document.createElement('button');
        reloadBtn.className = 'reload-socket-btn';
        reloadBtn.textContent = '🔄 Recargar';
        reloadBtn.style.cssText = 'padding:0.25rem 0.5rem;font-size:0.65rem;border:none;border-radius:4px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;cursor:pointer;font-weight:700;';
        reloadBtn.onclick = function () {
          connectTikTok();
        };
        statusContainer.appendChild(reloadBtn);
      }

      if (connected) {
        console.log('✅ Socket conectado - Listo para recibir regalos');
      } else {
        console.log('⚠️ Socket desconectado - No se recibirán regalos');
      }
    }

    // Actualizar estado de TikTok Live
    function updateTikTokStatus(status) {
      const statusContainer = document.getElementById('socketStatus');
      const statusEl = document.getElementById('socketStatusText');

      if (!statusContainer || !statusEl) return;

      // Limpiar botón de recargar si existe
      const existingBtn = statusContainer.querySelector('.reload-tiktok-btn');
      if (existingBtn) existingBtn.remove();

      if (status.connected) {
        statusEl.textContent = '🟢 TikTok Live conectado - Recibiendo regalos';
        statusEl.style.color = '#22c55e';
      } else if (status.reconnecting || status.connecting) {
        // El servidor está auto-reconectando
        statusEl.textContent = status.message || '🟡 Reconectando a TikTok automáticamente...';
        statusEl.style.color = '#fbbf24';
      } else {
        if (status.error) {
          const errorMsg = status.error?.exception || status.error?.info || 'Error desconocido';
          if (errorMsg.includes('Unexpected server response')) {
            statusEl.textContent = '⚠️ Usuario no está en LIVE';
            statusEl.style.color = '#fbbf24';
          } else {
            statusEl.textContent = '🔴 TikTok desconectado';
            statusEl.style.color = '#ef4444';
          }

          // Agregar botón de reconectar
          const reloadBtn = document.createElement('button');
          reloadBtn.className = 'reload-tiktok-btn';
          reloadBtn.textContent = '🔄 Reconectar';
          reloadBtn.style.cssText = 'padding:0.25rem 0.5rem;font-size:0.65rem;border:none;border-radius:4px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;cursor:pointer;font-weight:700;';
          reloadBtn.onclick = function () { connectTikTok(); };
          statusContainer.appendChild(reloadBtn);
        } else {
          statusEl.textContent = '🟡 Conectando a TikTok...';
          statusEl.style.color = '#fbbf24';
        }
      }

      if (status.connected) {
        console.log('✅ TikTok Live conectado - Listo para recibir regalos');
      } else {
        console.log('⚠️ TikTok Live desconectado:', status.error || status.reason);
      }
    }

    // Actualizar estado de conexión en el modal de configuración
    function updateTikTokConnectionStatus(status) {
      const statusEl = document.getElementById('tiktokConnectionStatus');
      if (!statusEl) return;

      // Limpiar contenido anterior
      statusEl.innerHTML = '';

      // Crear span para el texto de estado
      const statusText = document.createElement('span');

      if (status.connected) {
        statusText.textContent = '🟢 Conectado a TikTok Live';
        statusText.style.color = '#22c55e';
        statusEl.appendChild(statusText);
      } else if (status.connecting) {
        statusText.textContent = '🟡 Conectando...';
        statusText.style.color = '#fbbf24';
        statusEl.appendChild(statusText);
      } else if (status.error) {
        const errorMsg = status.error?.exception || status.error?.info || status.message || 'Error desconocido';
        if (errorMsg.includes('Unexpected server response') || errorMsg.includes('200')) {
          statusText.textContent = '⚠️ Usuario no está en LIVE o ID incorrecto';
          statusText.style.color = '#fbbf24';
        } else {
          statusText.textContent = `🔴 Error: ${errorMsg.substring(0, 50)}`;
          statusText.style.color = '#ef4444';
        }
        statusEl.appendChild(statusText);

        // Agregar botón de recargar cuando hay error
        const reloadBtn = document.createElement('button');
        reloadBtn.textContent = '🔄 Recargar';
        reloadBtn.style.cssText = 'padding:0.3rem 0.6rem;font-size:0.7rem;border:none;border-radius:6px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;cursor:pointer;font-weight:700;';
        reloadBtn.onclick = function () {
          connectTikTok();
        };
        statusEl.appendChild(reloadBtn);
      } else if (status.message) {
        statusText.textContent = status.message;
        if (status.message.includes('🟢')) {
          statusText.style.color = '#22c55e';
        } else if (status.message.includes('⚠️') || status.message.includes('🟡')) {
          statusText.style.color = '#fbbf24';
        } else {
          statusText.style.color = '#ef4444';
        }
        statusEl.appendChild(statusText);

        // Si el mensaje indica desconexión, agregar botón de recargar
        if (!status.message.includes('🟢') && !status.message.includes('Conectando')) {
          const reloadBtn = document.createElement('button');
          reloadBtn.textContent = '🔄 Recargar';
          reloadBtn.style.cssText = 'padding:0.3rem 0.6rem;font-size:0.7rem;border:none;border-radius:6px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;cursor:pointer;font-weight:700;';
          reloadBtn.onclick = function () {
            connectTikTok();
          };
          statusEl.appendChild(reloadBtn);
        }
      } else {
        statusText.textContent = '⚪ No conectado';
        statusText.style.color = '#94a3b8';
        statusEl.appendChild(statusText);

        // Agregar botón de recargar cuando no está conectado
        const reloadBtn = document.createElement('button');
        reloadBtn.textContent = '🔄 Recargar';
        reloadBtn.style.cssText = 'padding:0.3rem 0.6rem;font-size:0.7rem;border:none;border-radius:6px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;cursor:pointer;font-weight:700;';
        reloadBtn.onclick = function () {
          connectTikTok();
        };
        statusEl.appendChild(reloadBtn);
      }
    }

    // Conectar a TikTok Live desde el frontend
    function connectTikTok() {
      const usernameInput = document.getElementById('tiktokUsername');
      if (!usernameInput) return;

      const username = usernameInput.value.trim();
      if (!username) {
        alert('⚠️ Por favor ingresa un nombre de usuario de TikTok');
        return;
      }

      // Guardar en localStorage
      localStorage.setItem('tiktokUsername', username);

      // Actualizar estado
      updateTikTokConnectionStatus({ connecting: true, message: '🟡 Conectando al servidor...' });

      // Si ya hay una conexión activa, desconectarla primero
      if (socket && socket.connected) {
        console.log('🔌 Desconectando conexión anterior...');
        socket.disconnect();
        socket = null;
      }

      // Conectar al servidor Socket.IO primero
      connectSocket();

      const sidInput = document.getElementById('sessionId');
      const ttcInput = document.getElementById('ttTargetIdc');
      const sessionId = sidInput ? sidInput.value.trim() : '';
      const ttTargetIdc = ttcInput ? ttcInput.value.trim() : '';

      // Esperar a que se conecte y luego solicitar conexión a TikTok
      const checkConnection = setInterval(() => {
        if (socket && socket.connected) {
          clearInterval(checkConnection);
          updateTikTokConnectionStatus({ connecting: true, message: `🟡 Conectando a @${username}...` });
          socket.emit('tiktok:connect', { username: username, sessionId: sessionId, ttTargetIdc: ttTargetIdc });
          console.log(`🔗 Solicitando conexión a TikTok Live: @${username}`);
        } else if (socket && !socket.connected) {
          // Si pasan más de 5 segundos sin conectar, mostrar error
          setTimeout(() => {
            if (!socket || !socket.connected) {
              clearInterval(checkConnection);
              updateTikTokConnectionStatus({
                error: true,
                message: '🔴 Error: No se pudo conectar al servidor. Verifica que el servidor esté corriendo.'
              });
            }
          }, 5000);
        }
      }, 100);

      // Limpiar el intervalo después de 10 segundos como máximo
      setTimeout(() => {
        clearInterval(checkConnection);
      }, 10000);
    }

    // Funciones para UI de Session ID
    function saveCookiesBtn() {
      const sid = document.getElementById('sessionId').value.trim();
      const ttc = document.getElementById('ttTargetIdc').value.trim();
      if (!sid) {
        alert("⚠️ El sessionid es obligatorio para este método.");
        return;
      }
      localStorage.setItem('sessionId', sid);
      localStorage.setItem('ttTargetIdc', ttc);
      alert("✅ Cookies guardadas. Por favor, conecta nuevamente a TikTok.");
    }

    // Cargar automáticamente las cookies guardadas al iniciar la página
    window.addEventListener('DOMContentLoaded', () => {
      const savedSid = localStorage.getItem('sessionId');
      const savedTtc = localStorage.getItem('ttTargetIdc');
      if (savedSid) document.getElementById('sessionId').value = savedSid;
      if (savedTtc) document.getElementById('ttTargetIdc').value = savedTtc;
    });

    function clearCookiesBtn() {
      localStorage.removeItem('sessionId');
      localStorage.removeItem('ttTargetIdc');
      document.getElementById('sessionId').value = '';
      document.getElementById('ttTargetIdc').value = '';
      alert("🗑️ Cookies limpiadas.");
    }

    // Manejar regalo recibido
    function handleGiftReceived(giftData) {
      if (!gameStarted) {
        console.log('⏸️ Juego pausado - Regalo recibido pero no procesado');
        return; // No procesar regalos si el juego no está iniciado
      }

      const { giftId: rawGiftId, diamonds, repeatCount, giftName, user } = giftData;

      // Limpiar giftId eliminando espacios
      const giftId = cleanGiftId(rawGiftId);
      if (giftId === null) {
        console.warn(`⚠️ giftId inválido recibido: "${rawGiftId}"`);
        return;
      }

      // Verificar si es el regalo especial (victoria inmediata)
      const specialGiftId = cleanGiftId(specialGift?.giftId);
      if (specialGift && giftId === specialGiftId) {
        
        // Obtener SIEMPRE el país que la rotación muestra actualmente
        const specialCountry = countries[specialGiftCountryIndex];
        
        if (specialCountry) {
          const previousPoints = specialCountry.v;
          console.log(`🏆 ¡REGALO ESPECIAL RECIBIDO! ${specialCountry.n} (que estaba en rotación) gana inmediatamente con ${giftName}! enviado por ${user?.name || 'Anónimo'}`);
          console.log(`   Puntos anteriores: ${previousPoints.toLocaleString()}, Meta: ${MAX.toLocaleString()}`);

          // ASIGNAR LA META COMPLETA PARA GANAR INMEDIATAMENTE
          specialCountry.v = MAX;
          specialCountry.d = (specialCountry.d || 0) + (diamonds || 0);

          // Asegurar que este país esté en primer lugar antes de terminar
          countries.sort((a, b) => {
            if (a.n === specialCountry.n) return -1;
            if (b.n === specialCountry.n) return 1;
            return b.v - a.v;
          });

          // Renderizar una vez para mostrar el cambio
          render();

          // Terminar el juego inmediatamente
          setTimeout(() => {
            endGame();
          }, 100);
          return;
        }
      }

      // Buscar el país que tiene este regalo asignado (buscar en el array de regalos)
      const country = countries.find(c =>
        c.gifts && c.gifts.some(g => cleanGiftId(g.giftId) === giftId)
      );

      if (!country) {
        console.log(`⚠️ Regalo ${giftId} (${giftName}) no está asignado a ningún país`);
        return;
      }

      // Calcular puntos: usar solo los diamantes del regalo
      // NOTA: repeatCount es el número de regalo en el combo, no un multiplicador
      // Cada evento GIFT ya representa un regalo individual, así que usamos solo diamonds
      const rawDiamonds = diamonds || 0;
      // Aplicar multiplicador de dificultad si está activado
      const points = difficultyEnabled ? rawDiamonds * difficultyMultiplier : rawDiamonds;

      // Sumar puntos al país
      const previousValue = country.v;
      country.v += points;
      if (country.v > MAX) country.v = MAX;

      // Acumular diamantes totales recibidos
      if (!country.d) country.d = 0;
      country.d += diamonds || 0;

      // Mostrar información del combo
      const comboInfo = repeatCount > 1 ? ` (Combo: ${repeatCount})` : '';
      console.log(`🎁 ${country.n} recibió ${points.toFixed(1)} puntos (${diamonds} 💎${comboInfo}) de ${user?.name || 'Anónimo'}`);

      // Obtener el elemento de la fila
      const row = rowElements.get(country.n);
      const bar = row?.querySelector('.bar');
      const runner = row?.querySelector('.runner');

      // Efecto de brillo en los bordes y super saiyan cuando recibe puntos
      if (row) {
        row.classList.add('receiving-points');
        if (runner) {
          runner.classList.add('super-saiyan');
          if (saiyanTimeouts.has(country.n)) {
            clearTimeout(saiyanTimeouts.get(country.n));
          }
          saiyanTimeouts.set(country.n, setTimeout(() => {
            if (rowElements.has(country.n)) {
              const r = rowElements.get(country.n).querySelector('.runner');
              if (r) r.classList.remove('super-saiyan');
            }
            saiyanTimeouts.delete(country.n);
          }, 2000));
        }
        setTimeout(() => {
          row.classList.remove('receiving-points');
        }, 800);
      }

      // Efecto de pulso en la barra
      if (bar) {
        bar.classList.add('receiving');
        setTimeout(() => {
          bar.classList.remove('receiving');
        }, 500);
      }

      // Reordenar países por valor
      const previousPosition = countries.findIndex(c => c.n === country.n);
      countries.sort((a, b) => b.v - a.v);
      const newPosition = countries.findIndex(c => c.n === country.n);

      // Actualizar Etiqueta de Donante (Nombre y Combo)
      const donorLabel = row?.querySelector('.donor-label');
      if (donorLabel) {
        donorLabel.textContent = `${user?.name || 'Alguien'}${comboInfo}`;
        donorLabel.className = 'donor-label active'; // Reseteamos clases

        // Puesto 1 (0): Oro, Puesto 2 (1): Plata, Puesto 3 (2): Bronce, Resto: Normal
        if (newPosition === 0) donorLabel.classList.add('donor-gold');
        else if (newPosition === 1) donorLabel.classList.add('donor-silver');
        else if (newPosition === 2) donorLabel.classList.add('donor-bronze');
        else donorLabel.classList.add('donor-normal');

        if (donorTimeouts.has(country.n)) clearTimeout(donorTimeouts.get(country.n));
        donorTimeouts.set(country.n, setTimeout(() => {
          if (rowElements.has(country.n)) {
            const l = rowElements.get(country.n).querySelector('.donor-label');
            if (l) l.classList.remove('active');
          }
          donorTimeouts.delete(country.n);
        }, 3000));
      }

      // Si el país subió de posición, crear efecto visual
      if (newPosition < previousPosition) {
        if (row) {
          row.classList.add('passing');
          createSparkles(row, 10);
          if (gameStarted) {
            playPassingSound();
          }
          setTimeout(() => {
            row.classList.remove('passing');
          }, 600);
        }
      }

      // Renderizar cambios
      render();

      // Verificar si alguien ganó
      if (countries[0].v >= MAX) {
        endGame();
      }
    }

    // ─── MANEJADOR DE COMENTARIOS DE CHAT ────────────────────────────────
    function handleChatComment({ user, comment }) {
      if (!comment || !gameStarted) return;

      const textLower = comment.toLowerCase();
      const now = Date.now();

      // Anti-spam: un usuario solo puede contar cada CHAT_COOLDOWN_MS
      const lastTime = chatUserCooldowns.get(user) || 0;
      if (now - lastTime < CHAT_COOLDOWN_MS) return;

      // Buscar país por nombre o emoji bandera
      function countryFlagEmoji(isoCode) {
        return isoCode.toUpperCase().split('').map(c =>
          String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)
        ).join('');
      }

      let matchedCountry = null;
      for (const c of countries) {
        const nameLower = c.n.toLowerCase();
        if (textLower.includes(nameLower)) { matchedCountry = c; break; }
        const flagEmoji = countryFlagEmoji(c.f);
        if (comment.includes(flagEmoji)) { matchedCountry = c; break; }
      }

      if (!matchedCountry) return;
      if (!matchedCountry.gifts || matchedCountry.gifts.length === 0) return;

      // Aplicar puntos e interacción ilimitada
      matchedCountry.v = Math.min(matchedCountry.v + chatPointsPerComment, MAX);
      chatUserCooldowns.set(user, now);

      console.log(`💬 @${user} votó por ${matchedCountry.n} (+${chatPointsPerComment}pts)`);
      showChatToast(user, matchedCountry.n, matchedCountry.f);
      render();
    }

    // Muestra una mini notificación de voto por chat
    let chatToastTimeout = null;
    function showChatToast(user, countryName, countryFlag) {
      let toast = document.getElementById('chatVoteToast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'chatVoteToast';
        toast.style.cssText = [
          'position:fixed', 'bottom:80px', 'right:12px', 'z-index:9000',
          'background:rgba(15,23,42,0.95)', 'border:1px solid rgba(34,211,238,.4)',
          'border-radius:12px', 'padding:0.5rem 0.8rem',
          'color:#fff', 'font-size:0.78rem', 'font-weight:700',
          'box-shadow:0 4px 20px rgba(0,0,0,.5)',
          'transition:opacity 0.4s', 'max-width:220px'
        ].join(';');
        document.body.appendChild(toast);
      }
      if (chatToastTimeout) clearTimeout(chatToastTimeout);
      toast.style.opacity = '1';
      toast.innerHTML = `💬 <span style="color:#38bdf8">@${user.substring(0,15)}</span> → <img src="https://flagcdn.com/w20/${countryFlag}.png" style="vertical-align:middle;width:16px;border-radius:2px"> ${countryName} <span style="color:#22d3ee">+${chatPointsPerComment}</span>`;
      chatToastTimeout = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
    }

    // Función para activar/desactivar puntos por comentarios
    function toggleChatPoints() {
      chatPointsEnabled = !chatPointsEnabled;
      localStorage.setItem('chatPointsEnabled', JSON.stringify(chatPointsEnabled));
      const btn = document.getElementById('chatPointsToggleBtn');
      if (btn) {
        btn.textContent = chatPointsEnabled ? '💬 Chat: ON' : '💬 Chat: OFF';
        btn.style.color = chatPointsEnabled ? '#020617' : '#fff';
        btn.style.background = chatPointsEnabled
          ? 'linear-gradient(135deg,#22d3ee,#6366f1)'
          : 'linear-gradient(135deg,#6b7280,#4b5563)';
      }
    }

    // ─── FUNCIONES DE DIFICULTAD ─────────────────────────────────────────────
    function toggleDifficulty() {
      difficultyEnabled = !difficultyEnabled;
      localStorage.setItem('difficultyEnabled', JSON.stringify(difficultyEnabled));
      updateDifficultyBtn();
    }

    function updateDifficultyBtn() {
      const btn = document.getElementById('difficultyToggleBtn');
      if (!btn) return;
      if (difficultyEnabled) {
        btn.textContent = `🎯 Dificultad: ON (×${difficultyMultiplier})`;
        btn.style.background = 'linear-gradient(135deg,#f97316,#ef4444)';
        btn.style.color = '#fff';
      } else {
        btn.textContent = '🎯 Dificultad: OFF';
        btn.style.background = 'linear-gradient(135deg,#6b7280,#4b5563)';
        btn.style.color = '#fff';
      }
    }

    function saveDifficultyConfig() {
      const multInput = document.getElementById('difficultyMultiplierInput');
      const chatInput = document.getElementById('chatPointsValueInput');

      if (multInput) {
        const val = parseFloat(multInput.value);
        if (!isNaN(val) && val > 0) {
          difficultyMultiplier = val;
          localStorage.setItem('difficultyMultiplier', String(val));
        }
      }
      if (chatInput) {
        const val = parseFloat(chatInput.value);
        if (!isNaN(val) && val >= 0) {
          chatPointsPerComment = val;
          localStorage.setItem('chatPointsPerComment', String(val));
        }
      }

      // Actualizar hint
      const hint = document.getElementById('difficultyHint');
      if (hint) {
        if (difficultyMultiplier === 1) {
          hint.textContent = '1 diamante = 1 punto (normal)';
        } else if (difficultyMultiplier > 1) {
          hint.textContent = `1 diamante = ${difficultyMultiplier} puntos (¡más fácil!)`;
        } else {
          hint.textContent = `1 diamante = ${difficultyMultiplier} puntos (más difícil)`;
        }
      }

      updateDifficultyBtn();

      // Feedback visual en el botón guardar
      const saveBtn = document.querySelector('[onclick="saveDifficultyConfig()"]');
      if (saveBtn) {
        const original = saveBtn.textContent;
        saveBtn.textContent = '✅ ¡Guardado!';
        saveBtn.style.background = 'linear-gradient(135deg,#22d3ee,#0ea5e9)';
        setTimeout(() => {
          saveBtn.textContent = original;
          saveBtn.style.background = 'linear-gradient(135deg,#10b981,#059669)';
        }, 2000);
      }
    }

    // Inicializar UI de dificultad al cargar la página
    function initDifficultyUI() {
      // Restaurar valores guardados en los inputs
      const multInput = document.getElementById('difficultyMultiplierInput');
      const chatInput = document.getElementById('chatPointsValueInput');
      if (multInput) multInput.value = difficultyMultiplier;
      if (chatInput) chatInput.value = chatPointsPerComment;

      // Actualizar hint
      const hint = document.getElementById('difficultyHint');
      if (hint) {
        if (difficultyMultiplier === 1) {
          hint.textContent = '1 diamante = 1 punto (normal)';
        } else if (difficultyMultiplier > 1) {
          hint.textContent = `1 diamante = ${difficultyMultiplier} puntos (¡más fácil!)`;
        } else {
          hint.textContent = `1 diamante = ${difficultyMultiplier} puntos (más difícil)`;
        }
      }

      // Actualizar botón de chat
      const chatBtn = document.getElementById('chatPointsToggleBtn');
      if (chatBtn) {
        chatBtn.textContent = chatPointsEnabled ? '💬 Chat: ON' : '💬 Chat: OFF';
        chatBtn.style.color = chatPointsEnabled ? '#020617' : '#fff';
        chatBtn.style.background = chatPointsEnabled
          ? 'linear-gradient(135deg,#22d3ee,#6366f1)'
          : 'linear-gradient(135deg,#6b7280,#4b5563)';
      }

      updateDifficultyBtn();
    }

    // ================= GESTIÓN DE PAÍSES =================

    let editingCountryIndex = -1; // -1 significa nuevo país

    // Lista completa de países con códigos ISO 3166-1 alpha-2
    const allCountries = [
      { code: "ad", name: "Andorra" }, { code: "ae", name: "Emiratos Árabes Unidos" }, { code: "af", name: "Afganistán" },
      { code: "ag", name: "Antigua y Barbuda" }, { code: "ai", name: "Anguila" }, { code: "al", name: "Albania" },
      { code: "am", name: "Armenia" }, { code: "ao", name: "Angola" }, { code: "aq", name: "Antártida" },
      { code: "ar", name: "Argentina" }, { code: "as", name: "Samoa Americana" }, { code: "at", name: "Austria" },
      { code: "au", name: "Australia" }, { code: "aw", name: "Aruba" }, { code: "ax", name: "Islas Åland" },
      { code: "az", name: "Azerbaiyán" }, { code: "ba", name: "Bosnia y Herzegovina" }, { code: "bb", name: "Barbados" },
      { code: "bd", name: "Bangladesh" }, { code: "be", name: "Bélgica" }, { code: "bf", name: "Burkina Faso" },
      { code: "bg", name: "Bulgaria" }, { code: "bh", name: "Baréin" }, { code: "bi", name: "Burundi" },
      { code: "bj", name: "Benín" }, { code: "bl", name: "San Bartolomé" }, { code: "bm", name: "Bermudas" },
      { code: "bn", name: "Brunéi" }, { code: "bo", name: "Bolivia" }, { code: "bq", name: "Caribe Neerlandés" },
      { code: "br", name: "Brasil" }, { code: "bs", name: "Bahamas" }, { code: "bt", name: "Bután" },
      { code: "bv", name: "Isla Bouvet" }, { code: "bw", name: "Botsuana" }, { code: "by", name: "Bielorrusia" },
      { code: "bz", name: "Belice" }, { code: "ca", name: "Canadá" }, { code: "cc", name: "Islas Cocos" },
      { code: "cd", name: "República Democrática del Congo" }, { code: "cf", name: "República Centroafricana" }, { code: "cg", name: "República del Congo" },
      { code: "ch", name: "Suiza" }, { code: "ci", name: "Costa de Marfil" }, { code: "ck", name: "Islas Cook" },
      { code: "cl", name: "Chile" }, { code: "cm", name: "Camerún" }, { code: "cn", name: "China" },
      { code: "co", name: "Colombia" }, { code: "cr", name: "Costa Rica" }, { code: "cu", name: "Cuba" },
      { code: "cv", name: "Cabo Verde" }, { code: "cw", name: "Curazao" }, { code: "cx", name: "Isla de Navidad" },
      { code: "cy", name: "Chipre" }, { code: "cz", name: "República Checa" }, { code: "de", name: "Alemania" },
      { code: "dj", name: "Yibuti" }, { code: "dk", name: "Dinamarca" }, { code: "dm", name: "Dominica" },
      { code: "do", name: "República Dominicana" }, { code: "dz", name: "Argelia" }, { code: "ec", name: "Ecuador" },
      { code: "ee", name: "Estonia" }, { code: "eg", name: "Egipto" }, { code: "eh", name: "Sahara Occidental" },
      { code: "er", name: "Eritrea" }, { code: "es", name: "España" }, { code: "et", name: "Etiopía" },
      { code: "fi", name: "Finlandia" }, { code: "fj", name: "Fiyi" }, { code: "fk", name: "Islas Malvinas" },
      { code: "fm", name: "Micronesia" }, { code: "fo", name: "Islas Feroe" }, { code: "fr", name: "Francia" },
      { code: "ga", name: "Gabón" }, { code: "gb", name: "Reino Unido" }, { code: "gd", name: "Granada" },
      { code: "ge", name: "Georgia" }, { code: "gf", name: "Guayana Francesa" }, { code: "gg", name: "Guernsey" },
      { code: "gh", name: "Ghana" }, { code: "gi", name: "Gibraltar" }, { code: "gl", name: "Groenlandia" },
      { code: "gm", name: "Gambia" }, { code: "gn", name: "Guinea" }, { code: "gp", name: "Guadalupe" },
      { code: "gq", name: "Guinea Ecuatorial" }, { code: "gr", name: "Grecia" }, { code: "gs", name: "Georgia del Sur" },
      { code: "gt", name: "Guatemala" }, { code: "gu", name: "Guam" }, { code: "gw", name: "Guinea-Bisáu" },
      { code: "gy", name: "Guyana" }, { code: "hk", name: "Hong Kong" }, { code: "hm", name: "Isla Heard" },
      { code: "hn", name: "Honduras" }, { code: "hr", name: "Croacia" }, { code: "ht", name: "Haití" },
      { code: "hu", name: "Hungría" }, { code: "id", name: "Indonesia" }, { code: "ie", name: "Irlanda" },
      { code: "il", name: "Israel" }, { code: "im", name: "Isla de Man" }, { code: "in", name: "India" },
      { code: "io", name: "Territorio Británico del Océano Índico" }, { code: "iq", name: "Irak" }, { code: "ir", name: "Irán" },
      { code: "is", name: "Islandia" }, { code: "it", name: "Italia" }, { code: "je", name: "Jersey" },
      { code: "jm", name: "Jamaica" }, { code: "jo", name: "Jordania" }, { code: "jp", name: "Japón" },
      { code: "ke", name: "Kenia" }, { code: "kg", name: "Kirguistán" }, { code: "kh", name: "Camboya" },
      { code: "ki", name: "Kiribati" }, { code: "km", name: "Comoras" }, { code: "kn", name: "San Cristóbal y Nieves" },
      { code: "kp", name: "Corea del Norte" }, { code: "kr", name: "Corea del Sur" }, { code: "kw", name: "Kuwait" },
      { code: "ky", name: "Islas Caimán" }, { code: "kz", name: "Kazajistán" }, { code: "la", name: "Laos" },
      { code: "lb", name: "Líbano" }, { code: "lc", name: "Santa Lucía" }, { code: "li", name: "Liechtenstein" },
      { code: "lk", name: "Sri Lanka" }, { code: "lr", name: "Liberia" }, { code: "ls", name: "Lesoto" },
      { code: "lt", name: "Lituania" }, { code: "lu", name: "Luxemburgo" }, { code: "lv", name: "Letonia" },
      { code: "ly", name: "Libia" }, { code: "ma", name: "Marruecos" }, { code: "mc", name: "Mónaco" },
      { code: "md", name: "Moldavia" }, { code: "me", name: "Montenegro" }, { code: "mf", name: "San Martín" },
      { code: "mg", name: "Madagascar" }, { code: "mh", name: "Islas Marshall" }, { code: "mk", name: "Macedonia del Norte" },
      { code: "ml", name: "Malí" }, { code: "mm", name: "Myanmar" }, { code: "mn", name: "Mongolia" },
      { code: "mo", name: "Macao" }, { code: "mp", name: "Islas Marianas del Norte" }, { code: "mq", name: "Martinica" },
      { code: "mr", name: "Mauritania" }, { code: "ms", name: "Montserrat" }, { code: "mt", name: "Malta" },
      { code: "mu", name: "Mauricio" }, { code: "mv", name: "Maldivas" }, { code: "mw", name: "Malaui" },
      { code: "mx", name: "México" }, { code: "my", name: "Malasia" }, { code: "mz", name: "Mozambique" },
      { code: "na", name: "Namibia" }, { code: "nc", name: "Nueva Caledonia" }, { code: "ne", name: "Níger" },
      { code: "nf", name: "Isla Norfolk" }, { code: "ng", name: "Nigeria" }, { code: "ni", name: "Nicaragua" },
      { code: "nl", name: "Países Bajos" }, { code: "no", name: "Noruega" }, { code: "np", name: "Nepal" },
      { code: "nr", name: "Nauru" }, { code: "nu", name: "Niue" }, { code: "nz", name: "Nueva Zelanda" },
      { code: "om", name: "Omán" }, { code: "pa", name: "Panamá" }, { code: "pe", name: "Perú" },
      { code: "pf", name: "Polinesia Francesa" }, { code: "pg", name: "Papúa Nueva Guinea" }, { code: "ph", name: "Filipinas" },
      { code: "pk", name: "Pakistán" }, { code: "pl", name: "Polonia" }, { code: "pm", name: "San Pedro y Miquelón" },
      { code: "pn", name: "Islas Pitcairn" }, { code: "pr", name: "Puerto Rico" }, { code: "ps", name: "Palestina" },
      { code: "pt", name: "Portugal" }, { code: "pw", name: "Palaos" }, { code: "py", name: "Paraguay" },
      { code: "qa", name: "Catar" }, { code: "re", name: "Reunión" }, { code: "ro", name: "Rumania" },
      { code: "rs", name: "Serbia" }, { code: "ru", name: "Rusia" }, { code: "rw", name: "Ruanda" },
      { code: "sa", name: "Arabia Saudí" }, { code: "sb", name: "Islas Salomón" }, { code: "sc", name: "Seychelles" },
      { code: "sd", name: "Sudán" }, { code: "se", name: "Suecia" }, { code: "sg", name: "Singapur" },
      { code: "sh", name: "Santa Elena" }, { code: "si", name: "Eslovenia" }, { code: "sj", name: "Svalbard y Jan Mayen" },
      { code: "sk", name: "Eslovaquia" }, { code: "sl", name: "Sierra Leona" }, { code: "sm", name: "San Marino" },
      { code: "sn", name: "Senegal" }, { code: "so", name: "Somalia" }, { code: "sr", name: "Surinam" },
      { code: "ss", name: "Sudán del Sur" }, { code: "st", name: "Santo Tomé y Príncipe" }, { code: "sv", name: "El Salvador" },
      { code: "sx", name: "Sint Maarten" }, { code: "sy", name: "Siria" }, { code: "sz", name: "Esuatini" },
      { code: "tc", name: "Islas Turcas y Caicos" }, { code: "td", name: "Chad" }, { code: "tf", name: "Territorios Australes Franceses" },
      { code: "tg", name: "Togo" }, { code: "th", name: "Tailandia" }, { code: "tj", name: "Tayikistán" },
      { code: "tk", name: "Tokelau" }, { code: "tl", name: "Timor Oriental" }, { code: "tm", name: "Turkmenistán" },
      { code: "tn", name: "Túnez" }, { code: "to", name: "Tonga" }, { code: "tr", name: "Turquía" },
      { code: "tt", name: "Trinidad y Tobago" }, { code: "tv", name: "Tuvalu" }, { code: "tw", name: "Taiwán" },
      { code: "tz", name: "Tanzania" }, { code: "ua", name: "Ucrania" }, { code: "ug", name: "Uganda" },
      { code: "um", name: "Islas Ultramarinas de Estados Unidos" }, { code: "us", name: "Estados Unidos" }, { code: "uy", name: "Uruguay" },
      { code: "uz", name: "Uzbekistán" }, { code: "va", name: "Ciudad del Vaticano" }, { code: "vc", name: "San Vicente y las Granadinas" },
      { code: "ve", name: "Venezuela" }, { code: "vg", name: "Islas Vírgenes Británicas" }, { code: "vi", name: "Islas Vírgenes de los Estados Unidos" },
      { code: "vn", name: "Vietnam" }, { code: "vu", name: "Vanuatu" }, { code: "wf", name: "Wallis y Futuna" },
      { code: "ws", name: "Samoa" }, { code: "xk", name: "Kosovo" }, { code: "ye", name: "Yemen" },
      { code: "yt", name: "Mayotte" }, { code: "za", name: "Sudáfrica" }, { code: "zm", name: "Zambia" },
      { code: "zw", name: "Zimbabue" }
    ];

    // Ordenar países alfabéticamente por nombre
    allCountries.sort((a, b) => a.name.localeCompare(b.name, 'es'));

    // Guardar países en localStorage
    function saveCountries() {
      localStorage.setItem('countriesConfig', JSON.stringify(countries));
    }

    // Limpiar regalos duplicados (mantener solo el primero encontrado)
    function cleanDuplicateGifts() {
      const usedGiftIds = new Set();
      let hasDuplicates = false;

      countries.forEach(country => {
        if (country.gifts && country.gifts.length > 0) {
          // Primero limpiar duplicados dentro del mismo país
          const countryGiftIds = new Set();
          country.gifts = country.gifts.filter(gift => {
            const giftId = cleanGiftId(gift.giftId);
            if (giftId === null || countryGiftIds.has(giftId)) {
              hasDuplicates = true;
              console.warn(`⚠️ Regalo duplicado removido dentro de ${country.n}: ${giftId}`);
              return false;
            }
            countryGiftIds.add(giftId);
            return true;
          });

          // Luego filtrar regalos duplicados entre países
          country.gifts = country.gifts.filter(gift => {
            const giftId = cleanGiftId(gift.giftId);
            if (giftId === null || usedGiftIds.has(giftId)) {
              hasDuplicates = true;
              console.warn(`⚠️ Regalo duplicado removido: ${giftId} del país ${country.n}`);
              return false; // Remover este regalo
            }
            usedGiftIds.add(giftId);
            return true; // Mantener este regalo
          });
        }
      });

      if (hasDuplicates) {
        saveCountries(); // Guardar cambios si hubo duplicados
        console.log('✅ Regalos duplicados eliminados');

        // Actualizar UI si está renderizada
        if (document.getElementById('countryGiftConfig')) {
          renderGiftConfig();
        }
      }
    }

    // Cargar países desde localStorage
    function loadCountries() {
      const saved = localStorage.getItem('countriesConfig');
      if (saved) {
        try {
          countries = JSON.parse(saved);
          // Asegurar que todos los países tengan las propiedades necesarias
          // Migrar de giftId/giftImg a gifts array si es necesario
          countries = countries.map(c => {
            // Si tiene giftId/giftImg antiguo, migrar a gifts array
            if (c.giftId && !c.gifts) {
              c.gifts = [{ giftId: c.giftId, giftImg: c.giftImg }];
              delete c.giftId;
              delete c.giftImg;
            }
            return {
              ...c,
              v: c.v || 0,
              p: c.p || 150,
              gifts: c.gifts || []
            };
          });

          // Limpiar regalos duplicados
          cleanDuplicateGifts();

          saveCountries(); // Guardar migración y limpieza
        } catch (e) {
          console.log('Error cargando países:', e);
          countries = JSON.parse(JSON.stringify(defaultCountries));
          saveCountries();
        }
      } else {
        countries = JSON.parse(JSON.stringify(defaultCountries));
        saveCountries();
      }
    }

    // Renderizar lista de países en el modal
    function saveWins() {
      localStorage.setItem(WINS_STORAGE_KEY, JSON.stringify(winCounts));
    }

    function syncWinsWithCountries() {
      countries.forEach(c => {
        if (winCounts[c.n] == null) {
          winCounts[c.n] = 0;
        }
      });
      saveWins();
    }

    function loadWins() {
      const saved = localStorage.getItem(WINS_STORAGE_KEY);
      if (saved) {
        try {
          winCounts = JSON.parse(saved) || {};
        } catch (e) {
          winCounts = {};
        }
      }
      syncWinsWithCountries();
    }

    function renderWinsList() {
      const winsList = document.getElementById("winsList");
      if (!winsList) return;
      syncWinsWithCountries();
      winsList.innerHTML = "";

      const ranked = countries
        .map(c => ({ ...c, wins: winCounts[c.n] || 0 }))
        .sort((a, b) => b.wins - a.wins || b.v - a.v);

      ranked.forEach((country, idx) => {
        const item = document.createElement("div");
        item.className = "top-item";
        item.style.animationDelay = `${idx * 0.08}s`;

        item.innerHTML = `
      <div class="top-rank">${idx + 1}.</div>
      <div class="top-info">
        <img class="top-flag" src="https://flagcdn.com/w40/${country.f}.png" alt="${country.n}">
        <div class="top-name">${country.n}</div>
      </div>
      <div class="top-value">${country.wins} victorias</div>
    `;

        winsList.appendChild(item);
      });
    }

    function renderCountriesList() {
      const listContainer = document.getElementById('countriesList');
      if (!listContainer) return;

      listContainer.innerHTML = '';

      if (countries.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.textAlign = 'center';
        emptyMsg.style.padding = '2rem';
        emptyMsg.style.opacity = '0.6';
        emptyMsg.textContent = 'No hay países agregados. Haz clic en "Agregar País" para empezar.';
        listContainer.appendChild(emptyMsg);
        return;
      }

      countries.forEach((country, idx) => {
        const item = document.createElement('div');
        item.className = 'country-list-item';

        const flag = document.createElement('img');
        flag.className = 'country-list-flag';
        flag.src = `https://flagcdn.com/w40/${country.f.toLowerCase()}.png`;
        flag.alt = country.n;
        flag.onerror = function () { this.style.display = 'none'; };

        const info = document.createElement('div');
        info.className = 'country-list-info';

        const name = document.createElement('div');
        name.className = 'country-list-name';
        name.textContent = country.n;

        const code = document.createElement('div');
        code.className = 'country-list-code';
        code.textContent = country.f.toUpperCase();

        info.appendChild(name);
        info.appendChild(code);

        const actions = document.createElement('div');
        actions.className = 'country-list-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'country-list-btn edit';
        editBtn.textContent = '✏️ Editar';
        editBtn.onclick = () => editCountry(idx);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'country-list-btn delete';
        deleteBtn.textContent = '🗑️ Eliminar';
        deleteBtn.onclick = () => deleteCountry(idx);

        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        item.appendChild(flag);
        item.appendChild(info);
        item.appendChild(actions);

        listContainer.appendChild(item);
      });
    }

    // Mostrar modal para agregar/editar país
    function showAddCountryModal(editIndex = -1) {
      editingCountryIndex = editIndex;
      const modal = document.getElementById('countryModal');
      const title = document.getElementById('countryModalTitle');
      const nameInput = document.getElementById('countryNameInput');
      const flagInput = document.getElementById('countryFlagInput');
      const colorInput = document.getElementById('countryColorInput');

      // Cerrar dropdown de banderas si está abierto
      closeFlagDropdown();

      if (editIndex >= 0 && editIndex < countries.length) {
        // Modo edición
        title.textContent = '✏️ Editar País';
        const country = countries[editIndex];
        nameInput.value = country.n;
        flagInput.value = country.f;
        colorInput.value = country.c;
        updateFlagPreview(country.f);
      } else {
        // Modo nuevo
        title.textContent = '➕ Agregar País';
        nameInput.value = '';
        flagInput.value = '';
        colorInput.value = '#3b82f6';
        updateFlagPreview('');
      }

      // Renderizar grid de banderas (vacío por ahora, se renderiza cuando se abre el dropdown)
      const flagGrid = document.getElementById('flagGrid');
      if (flagGrid) flagGrid.innerHTML = '';

      modal.style.display = 'flex';
    }

    // Cerrar modal de país
    function closeCountryModal() {
      const modal = document.getElementById('countryModal');
      modal.style.display = 'none';
      editingCountryIndex = -1;
      closeFlagDropdown();
    }

    // Actualizar preview de bandera
    function updateFlagPreview(flagCode) {
      const preview = document.getElementById('flagPreview');
      const codeDisplay = document.getElementById('flagCodeDisplay');
      const flagInput = document.getElementById('countryFlagInput');

      if (!preview || !codeDisplay || !flagInput) return;

      if (flagCode && flagCode.length === 2) {
        const country = allCountries.find(c => c.code === flagCode.toLowerCase());
        const flagImg = document.createElement('img');
        flagImg.src = `https://flagcdn.com/w40/${flagCode.toLowerCase()}.png`;
        flagImg.style.width = '100%';
        flagImg.style.height = '100%';
        flagImg.style.objectFit = 'cover';
        flagImg.style.borderRadius = '4px';
        flagImg.style.boxShadow = '0 2px 4px rgba(0,0,0,.3)';
        flagImg.onerror = function () {
          preview.innerHTML = '<span style="font-size:1.2rem;">🏳️</span>';
        };
        preview.innerHTML = '';
        preview.appendChild(flagImg);

        codeDisplay.textContent = country ? country.name : flagCode.toUpperCase();
        flagInput.value = flagCode.toLowerCase();
      } else {
        preview.innerHTML = '<span style="font-size:1.2rem;">🏳️</span>';
        codeDisplay.textContent = 'Seleccionar';
        flagInput.value = '';
      }
    }

    // Renderizar grid de banderas
    function renderFlagGrid(searchTerm = '') {
      const flagGrid = document.getElementById('flagGrid');
      if (!flagGrid) return;

      flagGrid.innerHTML = '';

      const filtered = allCountries.filter(country => {
        if (!searchTerm) return true;
        const search = searchTerm.toLowerCase();
        return country.name.toLowerCase().includes(search) ||
          country.code.toLowerCase().includes(search);
      });

      const currentFlagCode = document.getElementById('countryFlagInput')?.value || '';

      filtered.forEach(country => {
        const flagItem = document.createElement('div');
        flagItem.className = 'flag-item';
        if (country.code === currentFlagCode) {
          flagItem.classList.add('selected');
        }

        flagItem.onclick = () => selectFlag(country.code, country.name);

        const flagImg = document.createElement('img');
        flagImg.src = `https://flagcdn.com/w40/${country.code}.png`;
        flagImg.alt = country.name;
        flagImg.onerror = function () { this.style.display = 'none'; };

        const flagName = document.createElement('div');
        flagName.className = 'flag-name';
        flagName.textContent = country.name;

        const flagCode = document.createElement('div');
        flagCode.className = 'flag-code-text';
        flagCode.textContent = country.code.toUpperCase();

        flagItem.appendChild(flagImg);
        flagItem.appendChild(flagName);
        flagItem.appendChild(flagCode);

        flagGrid.appendChild(flagItem);
      });
    }

    // Seleccionar bandera
    function selectFlag(flagCode, flagName) {
      updateFlagPreview(flagCode);
      closeFlagDropdown();

      // Remover selección anterior
      document.querySelectorAll('.flag-item').forEach(item => {
        item.classList.remove('selected');
      });

      // Marcar como seleccionado
      const flagGrid = document.getElementById('flagGrid');
      if (flagGrid) {
        flagGrid.querySelectorAll('.flag-item').forEach(item => {
          if (item.querySelector('.flag-code-text')?.textContent === flagCode.toUpperCase()) {
            item.classList.add('selected');
          }
        });
      }
    }

    // Toggle dropdown de banderas
    function toggleFlagDropdown() {
      const dropdown = document.getElementById('flagDropdown');
      const btn = document.getElementById('flagSelectorBtn');

      if (!dropdown || !btn) return;

      const isOpen = dropdown.classList.contains('show');

      if (!isOpen) {
        // Cerrar otros dropdowns
        document.querySelectorAll('.flag-dropdown').forEach(dd => {
          dd.classList.remove('show');
        });
        document.querySelectorAll('.flag-selector-btn').forEach(b => {
          b.classList.remove('active');
        });

        // Abrir este dropdown
        dropdown.classList.add('show');
        btn.classList.add('active');

        // Renderizar grid (siempre para asegurar que se muestra la selección correcta)
        renderFlagGrid();

        // Limpiar búsqueda
        const searchInput = document.getElementById('flagSearchInput');
        if (searchInput) searchInput.value = '';
      } else {
        closeFlagDropdown();
      }
    }

    // Cerrar dropdown de banderas
    function closeFlagDropdown() {
      const dropdown = document.getElementById('flagDropdown');
      const btn = document.getElementById('flagSelectorBtn');

      if (dropdown) dropdown.classList.remove('show');
      if (btn) btn.classList.remove('active');
    }

    // Filtrar banderas
    function filterFlags() {
      const searchInput = document.getElementById('flagSearchInput');
      if (!searchInput) return;

      renderFlagGrid(searchInput.value);
    }

    // Guardar país (nuevo o editado)
    function saveCountry() {
      const nameInput = document.getElementById('countryNameInput');
      const flagInput = document.getElementById('countryFlagInput');
      const colorInput = document.getElementById('countryColorInput');

      const name = nameInput.value.trim();
      const flag = flagInput.value.trim().toLowerCase();
      const color = colorInput.value;

      // Validaciones
      if (!name) {
        alert('⚠️ Por favor ingresa un nombre para el país');
        return;
      }

      if (!flag || flag.length !== 2) {
        alert('⚠️ Por favor selecciona una bandera del selector');
        return;
      }

      // Verificar si el nombre ya existe (excepto si estamos editando el mismo)
      const existingIndex = countries.findIndex((c, idx) =>
        c.n.toLowerCase() === name.toLowerCase() && idx !== editingCountryIndex
      );
      if (existingIndex >= 0) {
        alert('⚠️ Ya existe un país con ese nombre');
        return;
      }

      const countryData = {
        n: name,
        f: flag,
        c: color,
        v: 0,
        p: 150,
        gifts: [],
        d: 0
      };

      if (editingCountryIndex >= 0 && editingCountryIndex < countries.length) {
        // Editar país existente (preservar valores actuales si el juego está corriendo)
        const existing = countries[editingCountryIndex];
        countryData.v = existing.v || 0;
        countryData.gifts = existing.gifts || [];
        countryData.d = existing.d || 0;
        countries[editingCountryIndex] = countryData;
      } else {
        // Agregar nuevo país
        countries.push(countryData);
      }

      saveCountries();
      renderCountriesList();
      renderGiftConfig(); // Actualizar lista de regalos
      closeCountryModal();
    }

    // Editar país
    function editCountry(index) {
      showAddCountryModal(index);
    }

    // Eliminar país
    function deleteCountry(index) {
      if (!confirm(`¿Estás seguro de que quieres eliminar "${countries[index].n}"?`)) {
        return;
      }

      countries.splice(index, 1);
      saveCountries();
      renderCountriesList();
      renderGiftConfig(); // Actualizar lista de regalos
    }

    // Event listeners
    document.addEventListener('DOMContentLoaded', function () {
      // Cerrar modal de país al hacer clic fuera
      const countryModal = document.getElementById('countryModal');
      if (countryModal) {
        countryModal.addEventListener('click', function (e) {
          if (e.target === countryModal) {
            closeCountryModal();
          }
        });

        // Cerrar dropdown de banderas al hacer clic fuera
        document.addEventListener('click', function (e) {
          const flagSelector = document.querySelector('.flag-selector');
          if (flagSelector && !flagSelector.contains(e.target)) {
            closeFlagDropdown();
          }
        });

        // Permitir Enter para guardar
        const nameInput = document.getElementById('countryNameInput');
        if (nameInput) {
          nameInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
              saveCountry();
            }
          });
        }

        // Enter en el input de búsqueda de banderas no debe guardar
        const flagSearchInput = document.getElementById('flagSearchInput');
        if (flagSearchInput) {
          flagSearchInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
              e.preventDefault();
            }
          });
        }
      }
    });

    // ================= FIN GESTIÓN DE PAÍSES =================

    // Cargar configuración guardada
    function loadSavedConfig() {
      // Cargar países primero
      loadCountries();
      loadWins();

      // Cargar configuración de regalos (legacy - migrar si existe)
      const saved = localStorage.getItem('countryGiftConfig');
      if (saved) {
        try {
          const config = JSON.parse(saved);
          countries.forEach(country => {
            if (config[country.n] && config[country.n].giftId && country.gifts.length === 0) {
              // Migrar de formato antiguo
              country.gifts = [{ giftId: config[country.n].giftId, giftImg: config[country.n].giftImg }];
            }
          });
          saveCountries(); // Guardar migración
          localStorage.removeItem('countryGiftConfig'); // Eliminar formato antiguo
        } catch (e) {
          console.log('Error cargando configuración:', e);
        }
      }

      // Cargar username de TikTok
      const savedTikTokUser = localStorage.getItem('tiktokUsername');
      if (savedTikTokUser) {
        const tiktokInput = document.getElementById('tiktokUsername');
        if (tiktokInput) {
          tiktokInput.value = savedTikTokUser;
        }
      }

      // Cargar cookies de bypass
      const savedSessionId = localStorage.getItem('sessionId');
      if (savedSessionId) {
        const sidInput = document.getElementById('sessionId');
        if (sidInput) sidInput.value = savedSessionId;
      }
      const savedTt = localStorage.getItem('ttTargetIdc');
      if (savedTt) {
        const ttInput = document.getElementById('ttTargetIdc');
        if (ttInput) ttInput.value = savedTt;
      }

      // Cargar regalo especial seleccionado
      const savedSpecialGift = localStorage.getItem('specialGiftId');
      if (savedSpecialGift) {
        selectedSpecialGiftId = Number(savedSpecialGift);
        updateSpecialGiftSelector();
      }

      // Renderizar lista de países
      renderCountriesList();

      // Renderizar configuración de regalos (solo si hay regalos cargados)
      if (gifts.length > 0) {
        renderGiftConfig();
      } else {
        console.warn('⚠️ No hay regalos cargados aún, esperando...');
        // Reintentar después de un momento
        setTimeout(() => {
          if (gifts.length > 0) {
            renderGiftConfig();
          }
        }, 1000);
      }
      renderWinsList();

      // Inicializar estado del botón de chat
      const chatBtn = document.getElementById('chatPointsToggleBtn');
      if (chatBtn) {
        chatBtn.textContent = chatPointsEnabled ? '💬 Puntos por Chat: ON' : '💬 Puntos por Chat: OFF';
        chatBtn.style.background = chatPointsEnabled
          ? 'linear-gradient(135deg,#22d3ee,#6366f1)'
          : 'linear-gradient(135deg,#6b7280,#4b5563)';
      }
    }

    // Guardar selección del regalo especial
    function saveSpecialGiftSelection() {
      if (selectedSpecialGiftId) {
        localStorage.setItem('specialGiftId', selectedSpecialGiftId.toString());
      } else {
        localStorage.removeItem('specialGiftId');
      }
    }

    // Actualizar selector del regalo especial
    function updateSpecialGiftSelector() {
      const btn = document.getElementById('specialGiftBtn');
      if (!btn) return;

      // Limpiar contenido del botón
      btn.innerHTML = '';

      if (selectedSpecialGiftId) {
        const gift = getGiftById(selectedSpecialGiftId);
        if (gift) {
          // Mostrar imagen del regalo seleccionado
          const img = document.createElement('img');
          img.src = gift.image;
          img.alt = gift.name;
          img.onerror = function () { this.style.display = 'none'; };
          btn.appendChild(img);

          const arrow = document.createElement('span');
          arrow.className = 'arrow';
          arrow.textContent = '▼';
          btn.appendChild(arrow);

          console.log(`✅ Regalo especial actualizado: ${gift.name}`);
          return;
        }
      }

      // Si no hay regalo seleccionado, mostrar placeholder
      const placeholder = document.createElement('span');
      placeholder.className = 'placeholder';
      placeholder.id = 'specialGiftPlaceholder';
      placeholder.textContent = '-- Seleccionar Regalo Especial --';
      btn.appendChild(placeholder);

      const arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.textContent = '▼';
      btn.appendChild(arrow);
    }

    // Toggle dropdown del regalo especial
    function toggleSpecialGiftDropdown() {
      const dropdown = document.getElementById('specialGiftDropdown');
      const btn = document.getElementById('specialGiftBtn');

      if (!dropdown || !btn) return;

      const isOpen = dropdown.classList.contains('show');

      if (!isOpen) {
        // Cerrar otros dropdowns
        document.querySelectorAll('.gift-dropdown').forEach(dd => {
          if (dd.id !== 'specialGiftDropdown') {
            dd.classList.remove('show');
          }
        });
        document.querySelectorAll('.gift-selector-btn').forEach(b => {
          if (b.id !== 'specialGiftBtn') {
            b.classList.remove('active');
          }
        });

        // Renderizar dropdown
        renderSpecialGiftDropdown();

        // Abrir este dropdown
        dropdown.classList.add('show');
        btn.classList.add('active');
      } else {
        closeSpecialGiftDropdown();
      }
    }

    // Cerrar dropdown del regalo especial
    function closeSpecialGiftDropdown() {
      const dropdown = document.getElementById('specialGiftDropdown');
      const btn = document.getElementById('specialGiftBtn');

      if (dropdown) dropdown.classList.remove('show');
      if (btn) btn.classList.remove('active');
    }

    // Renderizar dropdown del regalo especial
    function renderSpecialGiftDropdown() {
      const dropdown = document.getElementById('specialGiftDropdown');
      if (!dropdown) return;

      dropdown.innerHTML = '';

      // Verificar que hay regalos cargados
      if (!gifts || gifts.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'gift-dropdown-empty';
        emptyMsg.textContent = 'Cargando regalos...';
        dropdown.appendChild(emptyMsg);
        return;
      }

      // Obtener regalos disponibles (200 diamonds en adelante, de menor a mayor)
      const filteredGifts = gifts.filter(gift => (gift.diamonds || 0) >= 200);
      const sortedGifts = [...filteredGifts].sort((a, b) => (a.diamonds || 0) - (b.diamonds || 0));

      // Si no hay regalos que cumplan el criterio
      if (sortedGifts.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'gift-dropdown-empty';
        emptyMsg.textContent = 'No hay regalos disponibles (mínimo 200 diamonds)';
        dropdown.appendChild(emptyMsg);
        return;
      }

      sortedGifts.forEach(gift => {
        const dropdownItem = document.createElement('div');
        dropdownItem.className = 'gift-dropdown-item';

        // Marcar como seleccionado si es el regalo actual
        const selectedId = cleanGiftId(selectedSpecialGiftId);
        const giftId = cleanGiftId(gift.giftId);
        if (selectedId !== null && giftId !== null && selectedId === giftId) {
          dropdownItem.classList.add('selected');
        }

        const giftImg = document.createElement('img');
        giftImg.src = gift.image;
        giftImg.alt = gift.name;
        giftImg.onerror = function () { 
          if(!this.getAttribute('data-tried-fallback')) {
            this.setAttribute('data-tried-fallback', 'true');
            if(gift.imageUrl) this.src = gift.imageUrl;
            else this.style.display = 'none';
          } else {
            this.style.display = 'none';
          }
        };

        const giftName = document.createElement('span');
        giftName.className = 'gift-name';
        giftName.innerHTML = `${gift.name} <span style="color:rgba(250,204,21,.9);font-weight:700;margin-left:0.5rem;">💎${gift.diamonds || 0}</span>`;

        dropdownItem.appendChild(giftImg);
        dropdownItem.appendChild(giftName);

        dropdownItem.addEventListener('click', function (e) {
          e.stopPropagation();

          // Actualizar selección
          selectedSpecialGiftId = gift.giftId;
          saveSpecialGiftSelection();

          // Actualizar visualización inmediatamente
          updateSpecialGiftSelector();

          // Actualizar el dropdown para marcar el seleccionado
          dropdown.querySelectorAll('.gift-dropdown-item').forEach(item => {
            item.classList.remove('selected');
          });
          dropdownItem.classList.add('selected');

          // Cerrar dropdown
          closeSpecialGiftDropdown();

          console.log(`🎁 Regalo especial seleccionado: ${gift.name} (ID: ${gift.giftId})`);
        });

        dropdown.appendChild(dropdownItem);
      });
    }

    // Cerrar dropdown al hacer clic fuera
    document.addEventListener('click', function (e) {
      const selector = document.getElementById('specialGiftSelector');
      if (selector && !selector.contains(e.target)) {
        closeSpecialGiftDropdown();
      }
    });

    // Guardar configuración (ahora los regalos están en el array de países)
    function saveConfig() {
      saveCountries(); // Los regalos ya están en el array de países
    }

    // Limpiar giftId: eliminar espacios y convertir a número
    function cleanGiftId(giftId) {
      if (giftId === null || giftId === undefined) return null;
      // Convertir a string, eliminar espacios, y luego a número
      const cleaned = String(giftId).replace(/\s/g, '').trim();
      return cleaned === '' ? null : Number(cleaned);
    }

    // Obtener regalo por ID
    function getGiftById(giftId) {
      if (!gifts || gifts.length === 0) {
        console.warn('⚠️ No hay regalos cargados aún');
        return null;
      }
      const cleanedId = cleanGiftId(giftId);
      if (cleanedId === null) return null;
      return gifts.find(g => cleanGiftId(g.giftId) === cleanedId);
    }

    // Obtener regalos disponibles (NO se permiten duplicados entre países)
    // Excluimos regalos que ya están asignados a CUALQUIER país (excepto el slot actual del país actual)
    function getAvailableGifts(currentCountryIdx, slotIndex = 0) {
      const currentCountry = countries[currentCountryIdx];
      if (!currentCountry) return [];

      // Verificar que hay regalos cargados
      if (!gifts || gifts.length === 0) {
        return [];
      }

      // Obtener IDs de regalos ya asignados a OTROS países
      const assignedGiftIds = [];
      countries.forEach((country, countryIdx) => {
        if (country.gifts && country.gifts.length > 0) {
          country.gifts.forEach((gift, giftIdx) => {
            // Excluir el regalo del slot actual que estamos editando
            if (!(countryIdx === currentCountryIdx && giftIdx === slotIndex)) {
              const cleanedId = cleanGiftId(gift.giftId);
              if (cleanedId !== null) {
                assignedGiftIds.push(cleanedId);
              }
            }
          });
        }
      });

      // Filtrar regalos: mostrar solo los que NO están asignados a ningún país
      const availableGifts = gifts.filter(gift => {
        const giftIdNum = cleanGiftId(gift.giftId);
        return giftIdNum !== null && !assignedGiftIds.includes(giftIdNum);
      });

      return availableGifts;
    }

    // Actualizar todos los dropdowns Y botones de selección para reflejar cambios en la biblioteca
    function updateAllDropdowns() {
      countries.forEach((country, countryIdx) => {
        for (let slotIndex = 0; slotIndex < 2; slotIndex++) {
          const dropdown = document.getElementById(`gift-dropdown-${countryIdx}-${slotIndex}`);
          const selectorBtn = document.getElementById(`gift-btn-${countryIdx}-${slotIndex}`);

          // — Actualizar el botón selector (icono o placeholder) sin importar si el dropdown está abierto —
          if (selectorBtn) {
            const currentGiftData = country.gifts && country.gifts[slotIndex]
              ? getGiftById(country.gifts[slotIndex].giftId)
              : null;
            // Limpiar contenido del botón (excepto la flecha)
            const arrow = selectorBtn.querySelector('.arrow');
            selectorBtn.innerHTML = '';
            if (currentGiftData) {
              const img = document.createElement('img');
              img.src = currentGiftData.image;
              img.alt = currentGiftData.name;
              img.onerror = function() { 
                if(!this.getAttribute('data-tried-fallback')) {
                  this.setAttribute('data-tried-fallback', 'true');
                  if(currentGiftData.imageUrl) this.src = currentGiftData.imageUrl;
                  else this.style.display = 'none';
                } else {
                  this.style.display = 'none';
                }
              };
              img.style.cssText = 'width:20px;height:20px;object-fit:contain;';
              const nameSpan = document.createElement('span');
              nameSpan.textContent = currentGiftData.name;
              nameSpan.style.cssText = 'font-size:0.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px;';
              selectorBtn.appendChild(img);
              selectorBtn.appendChild(nameSpan);
            } else {
              const placeholder = document.createElement('span');
              placeholder.className = 'placeholder';
              placeholder.textContent = '-- Seleccionar --';
              selectorBtn.appendChild(placeholder);
            }
            if (arrow) selectorBtn.appendChild(arrow);
            else {
              const newArrow = document.createElement('span');
              newArrow.className = 'arrow';
              newArrow.textContent = '▼';
              selectorBtn.appendChild(newArrow);
            }
          }

          // Rellenar el dropdown (siempre, para que esté listo al mostrarse)
          if (!dropdown) continue;

          // Limpiar dropdown
          dropdown.innerHTML = '';

          // Obtener regalos disponibles para este slot
          let availableGifts = getAvailableGifts(countryIdx, slotIndex);

          // Obtener regalo actual en este slot
          const currentGift = country.gifts && country.gifts[slotIndex]
            ? getGiftById(country.gifts[slotIndex].giftId)
            : null;

          // Si el país tiene un regalo asignado, verificar que no esté duplicado
          if (currentGift) {
            // Verificar si este regalo está asignado a OTRO país
            const currentGiftId = cleanGiftId(currentGift.giftId);
            const isAssignedToOther = countries.some((c, cIdx) => {
              if (cIdx === countryIdx) return false; // Excluir el país actual
              if (!c.gifts || c.gifts.length === 0) return false;
              return c.gifts.some(g => cleanGiftId(g.giftId) === currentGiftId);
            });

            // Si NO está asignado a otro país, agregarlo a la lista (si no está ya)
            if (currentGiftId !== null && !isAssignedToOther && !availableGifts.find(g => cleanGiftId(g.giftId) === currentGiftId)) {
              availableGifts.unshift(currentGift);
            }
            // Si está asignado a otro país, NO agregarlo (es un duplicado que debe ser removido)
          }

          // Si no hay regalos disponibles, mostrar mensaje
          if (availableGifts.length === 0 && !currentGift) {
            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'gift-dropdown-empty';
            emptyMsg.textContent = 'No hay regalos disponibles';
            dropdown.appendChild(emptyMsg);
            continue;
          }

          // Agregar opción para deseleccionar (si hay un regalo asignado)
          if (currentGift) {
            const clearItem = document.createElement('div');
            clearItem.className = 'gift-dropdown-item';
            clearItem.style.borderBottom = '2px solid rgba(255,255,255,.2)';
            clearItem.style.marginBottom = '.3rem';
            clearItem.style.paddingBottom = '.8rem';

            const clearText = document.createElement('span');
            clearText.className = 'gift-name';
            clearText.textContent = '❌ Quitar regalo';
            clearText.style.color = 'rgba(239,68,68,.8)';
            clearText.style.fontWeight = '700';

            clearItem.appendChild(clearText);

            clearItem.addEventListener('click', function () {
              // Remover regalo del slot
              if (country.gifts && country.gifts[slotIndex]) {
                country.gifts.splice(slotIndex, 1);
              }
              saveConfig();

              // Cerrar este dropdown y refrescar TODOS los dropdowns y botones
              // Sin reconstruir el DOM completo (sin titilar)
              dropdown.classList.remove('show');
              if (selectorBtn) selectorBtn.classList.remove('active');
              updateAllDropdowns();
            });

            dropdown.appendChild(clearItem);
          }

          // Ordenar regalos disponibles por diamonds (menor a mayor), pero mantener el regalo actual primero
          const currentGiftId = currentGift ? cleanGiftId(currentGift.giftId) : null;
          const sortedGifts = [...availableGifts].sort((a, b) => {
            const aId = cleanGiftId(a.giftId);
            const bId = cleanGiftId(b.giftId);
            if (currentGiftId !== null && currentGiftId === aId) return -1;
            if (currentGiftId !== null && currentGiftId === bId) return 1;
            return (a.diamonds || 0) - (b.diamonds || 0);
          });

          // Crear items del dropdown
          sortedGifts.forEach(gift => {
            // Verificar si este regalo está asignado a otro país ANTES de crear el item
            const giftId = cleanGiftId(gift.giftId);
            if (giftId === null) return; // Saltar si el ID no es válido

            let assignedCountryName = null;
            const isAssignedToOther = countries.some((c, cIdx) => {
              if (cIdx === countryIdx) return false; // Excluir el país actual
              if (!c.gifts || c.gifts.length === 0) return false;
              const isAssigned = c.gifts.some(g => cleanGiftId(g.giftId) === giftId);
              if (isAssigned) {
                assignedCountryName = c.n;
              }
              return isAssigned;
            });

            // Si está asignado a otro país y NO es el regalo actual del slot actual, NO mostrarlo
            // (getAvailableGifts ya debería haberlo filtrado, pero por seguridad)
            const currentGiftId = currentGift ? cleanGiftId(currentGift.giftId) : null;
            if (isAssignedToOther && currentGiftId !== giftId) {
              // NO crear el item si está asignado a otro país
              return; // Saltar este regalo
            }

            const dropdownItem = document.createElement('div');
            dropdownItem.className = 'gift-dropdown-item';
            dropdownItem.dataset.giftId = gift.giftId;

            // Marcar como seleccionado si es el regalo actual
            if (currentGiftId !== null && currentGiftId === giftId) {
              dropdownItem.classList.add('selected');
            }

            const giftImg = document.createElement('img');
            giftImg.src = gift.image;
            giftImg.alt = gift.name;
            giftImg.onerror = function () { 
              if(!this.getAttribute('data-tried-fallback')) {
                this.setAttribute('data-tried-fallback', 'true');
                if(gift.imageUrl) this.src = gift.imageUrl;
                else this.style.display = 'none';
              } else {
                this.style.display = 'none';
              }
            };

            const giftName = document.createElement('span');
            giftName.className = 'gift-name';
            const isNew = newGiftIds.has(giftId);
            giftName.innerHTML = `${gift.name}${isNew ? ' <span style="background:#22d3ee;color:#020617;font-size:0.6rem;font-weight:900;padding:1px 5px;border-radius:6px;vertical-align:middle;letter-spacing:0.5px;">NEW</span>' : ''} <span style="color:rgba(250,204,21,.9);font-weight:700;margin-left:0.5rem;">💎${gift.diamonds || 0}</span>`;

            dropdownItem.appendChild(giftImg);
            dropdownItem.appendChild(giftName);

            // Permitir clic (ya verificamos que no está asignado a otro país)
            dropdownItem.addEventListener('click', function (e) {
              e.stopPropagation();

              // Validación final: verificar que el regalo no esté asignado a otro país
              const clickedGiftId = cleanGiftId(gift.giftId);
              if (clickedGiftId === null) {
                alert(`⚠️ ID de regalo inválido`);
                return;
              }

              const stillAssigned = countries.some((c, cIdx) => {
                if (cIdx === countryIdx) return false;
                if (!c.gifts || c.gifts.length === 0) return false;
                return c.gifts.some(g => cleanGiftId(g.giftId) === clickedGiftId);
              });

              if (stillAssigned) {
                alert(`⚠️ Este regalo ya está asignado a otro país. Por favor selecciona otro regalo.`);
                return;
              }

              // Asegurar que el array existe
              if (!country.gifts) country.gifts = [];

              // Verificar que no se esté duplicando en el mismo país
              const alreadyInCountry = country.gifts.some((g, idx) =>
                idx !== slotIndex && cleanGiftId(g.giftId) === clickedGiftId
              );

              if (alreadyInCountry) {
                alert(`⚠️ Este regalo ya está asignado a otro slot de ${country.n}.`);
                return;
              }

              // Actualizar o agregar regalo en el slot
              const cleanedGiftId = cleanGiftId(gift.giftId);
              if (cleanedGiftId === null) {
                alert(`⚠️ ID de regalo inválido`);
                return;
              }
              if (country.gifts[slotIndex]) {
                country.gifts[slotIndex] = { giftId: cleanedGiftId, giftImg: gift.image };
              } else {
                country.gifts.push({ giftId: cleanedGiftId, giftImg: gift.image });
              }

              // Quitar badge de nuevo al asignarlo
              markGiftAsUsed(cleanedGiftId);

              saveConfig();

              // Actualizar todos los dropdowns y botones (sin reconstruir el DOM)
              updateAllDropdowns();

              // Cerrar solo este dropdown
              const selectorBtnF = document.getElementById(`gift-btn-${countryIdx}-${slotIndex}`);
              if (selectorBtnF) selectorBtnF.classList.remove('active');
              dropdown.classList.remove('show');
            });

            dropdown.appendChild(dropdownItem);
          });
        }
      });
    }

    // Renderizar configuración de regalos por país (hasta 2 regalos por país)
    function renderGiftConfig() {
      const countryGiftConfig = document.getElementById('countryGiftConfig');
      if (!countryGiftConfig) return;

      countryGiftConfig.innerHTML = '';

      // Verificar que hay regalos cargados
      if (!gifts || gifts.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.cssText = 'text-align:center;padding:2rem;opacity:0.6;';
        emptyMsg.textContent = 'Cargando regalos...';
        countryGiftConfig.appendChild(emptyMsg);
        return;
      }

      countries.forEach((country, countryIdx) => {
        const item = document.createElement('div');
        item.className = 'country-config-item';
        item.style.flexDirection = 'column';
        item.style.gap = '0.8rem';

        // Label del país
        const label = document.createElement('div');
        label.className = 'country-config-label';
        label.textContent = country.n;
        label.style.width = '100%';
        label.style.marginBottom = '0.5rem';
        item.appendChild(label);

        // Contenedor para los selectores de regalos
        const selectorsContainer = document.createElement('div');
        selectorsContainer.style.display = 'flex';
        selectorsContainer.style.flexDirection = 'column';
        selectorsContainer.style.gap = '0.6rem';
        selectorsContainer.style.width = '100%';

        // Crear hasta 2 selectores de regalos
        for (let slotIndex = 0; slotIndex < 2; slotIndex++) {
          const slotWrapper = document.createElement('div');
          slotWrapper.style.display = 'flex';
          slotWrapper.style.alignItems = 'center';
          slotWrapper.style.gap = '0.5rem';

          // Label del slot
          const slotLabel = document.createElement('span');
          slotLabel.textContent = `Regalo ${slotIndex + 1}:`;
          slotLabel.style.fontSize = '0.85rem';
          slotLabel.style.fontWeight = '600';
          slotLabel.style.color = 'rgba(255,255,255,0.7)';
          slotLabel.style.minWidth = '80px';
          slotWrapper.appendChild(slotLabel);

          // Selector personalizado
          const selectorWrapper = document.createElement('div');
          selectorWrapper.className = 'custom-gift-selector';
          selectorWrapper.id = `gift-selector-${countryIdx}-${slotIndex}`;
          selectorWrapper.style.flex = '1';

          // Botón del selector
          const selectorBtn = document.createElement('div');
          selectorBtn.className = 'gift-selector-btn';
          selectorBtn.id = `gift-btn-${countryIdx}-${slotIndex}`;

          const currentGift = country.gifts && country.gifts[slotIndex]
            ? getGiftById(country.gifts[slotIndex].giftId)
            : null;

          if (currentGift) {
            const img = document.createElement('img');
            img.src = currentGift.image;
            img.alt = currentGift.name;
            img.onerror = function () { 
              if(!this.getAttribute('data-tried-fallback')) {
                this.setAttribute('data-tried-fallback', 'true');
                if(currentGift.imageUrl) this.src = currentGift.imageUrl;
                else this.style.display = 'none';
              } else {
                this.style.display = 'none';
              }
            };
            selectorBtn.appendChild(img);
          } else {
            const placeholder = document.createElement('span');
            placeholder.className = 'placeholder';
            placeholder.textContent = '-- Seleccionar --';
            selectorBtn.appendChild(placeholder);
          }

          const arrow = document.createElement('span');
          arrow.className = 'arrow';
          arrow.textContent = '▼';
          selectorBtn.appendChild(arrow);

          // Dropdown
          const dropdown = document.createElement('div');
          dropdown.className = 'gift-dropdown';
          dropdown.id = `gift-dropdown-${countryIdx}-${slotIndex}`;

          // Toggle dropdown
          selectorBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            const isActive = selectorBtn.classList.contains('active');

            // Cerrar todos los demás dropdowns
            document.querySelectorAll('.gift-dropdown').forEach(dd => {
              if (dd.id !== dropdown.id) {
                dd.classList.remove('show');
              }
            });
            document.querySelectorAll('.gift-selector-btn').forEach(btn => {
              if (btn.id !== selectorBtn.id) {
                btn.classList.remove('active');
              }
            });

            // Actualizar dropdown antes de abrir
            if (!isActive) {
              updateAllDropdowns();
            }

            // Toggle este dropdown
            selectorBtn.classList.toggle('active');
            dropdown.classList.toggle('show');
          });

          selectorWrapper.appendChild(selectorBtn);
          selectorWrapper.appendChild(dropdown);
          slotWrapper.appendChild(selectorWrapper);
          selectorsContainer.appendChild(slotWrapper);
        }

        item.appendChild(selectorsContainer);
        countryGiftConfig.appendChild(item);
      });

      // Inicializar dropdowns con regalos disponibles
      updateAllDropdowns();
    }

    // Actualizar preview del regalo (versión para selector personalizado) - Ya no se usa
    function updateGiftPreviewCustom(idx) {
      // Función obsoleta - los regalos se muestran directamente en los selectores
    }

    // Actualizar preview del regalo (mantener para compatibilidad)
    function updateGiftPreview(selectElement) {
      const idx = selectElement.id.split('-')[2];
      const preview = document.getElementById(`gift-preview-${idx}`);
      const selectedGiftId = parseInt(selectElement.value);

      if (selectedGiftId) {
        const gift = getGiftById(selectedGiftId);
        if (gift && preview) {
          preview.src = gift.image;
          preview.onerror = function() {
            if(!this.getAttribute('data-tried-fallback')) {
              this.setAttribute('data-tried-fallback', 'true');
              if(gift.imageUrl) this.src = gift.imageUrl;
            }
          };
          preview.style.display = 'inline-block';
        }
      } else {
        if (preview) preview.style.display = 'none';
      }
    }

    // Cargar configuración al iniciar (después de que los regalos se carguen)
    loadGifts().then(() => {
      loadSavedConfig();
    }).catch(() => {
      // Si falla la carga, intentar cargar configuración de todas formas
      console.warn('⚠️ Cargando configuración sin regalos');
      loadSavedConfig();
    });

    // No conectar automáticamente - solo cuando el usuario presione el botón

    // Sistema de sonidos
    let audioContext = null;

    function initAudio() {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
    }

    function playSound(frequency, duration, type = 'sine', volume = 0.3) {
      if (!audioContext) initAudio();

      try {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = frequency;
        oscillator.type = type;

        gainNode.gain.setValueAtTime(0, audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + duration);
      } catch (e) {
        console.log('Error de audio:', e);
      }
    }

    function playPassingSound() {
      // Sonido suave de "whoosh" cuando alguien pasa
      playSound(350, 0.12, 'sine', 0.08);
      setTimeout(() => playSound(420, 0.08, 'sine', 0.06), 30);
    }

    function playApplauseSound() {
      // Sonido de aplausos usando múltiples frecuencias
      for (let i = 0; i < 20; i++) {
        setTimeout(() => {
          const freq = 200 + Math.random() * 300;
          playSound(freq, 0.3 + Math.random() * 0.2, 'square', 0.1);
        }, i * 50);
      }
    }

    function safeImg(url) {
      // fallback si falta imagen: muestra un cuadrito
      return url ? url : "";
    }

    // Mapa para mantener referencias de los elementos
    const rowElements = new Map();
    // Mapa para rastrear posiciones anteriores
    const previousPositions = new Map();
    // Mapa para rastrear timeouts del aura super saiyan
    const saiyanTimeouts = new Map();
    // Mapa para rastrear timeouts de las etiquetas flotantes de donantes
    const donorTimeouts = new Map();

    function createSparkles(element, count = 8) {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const trackRect = track.getBoundingClientRect();

      for (let i = 0; i < count; i++) {
        const sparkle = document.createElement("div");
        sparkle.className = "sparkle";

        const angle = (Math.PI * 2 * i) / count;
        const distance = 40 + Math.random() * 30;
        const tx = Math.cos(angle) * distance;
        const ty = Math.sin(angle) * distance;

        sparkle.style.left = `${centerX - trackRect.left}px`;
        sparkle.style.top = `${centerY - trackRect.top}px`;
        sparkle.style.setProperty('--tx', `${tx}px`);
        sparkle.style.setProperty('--ty', `${ty}px`);

        track.appendChild(sparkle);

        setTimeout(() => sparkle.remove(), 800);
      }
    }

    function updateGoal() {
      // goalEl.textContent = `💰 Meta: $${MAX.toLocaleString()}`;
      goalEl.textContent = `💰 Quien sera el campeon?`
      const maxValue = Math.max(...countries.map(c => c.v));
      const percent = (maxValue / MAX) * 100;

      if (percent >= 90) {
        goalEl.classList.add('danger');
      } else if (percent >= 70) {
        goalEl.classList.add('warning');
      } else {
        goalEl.classList.remove('warning', 'danger');
      }
    }

    // Función auxiliar para obtener el color del giftbox según la posición
    function getWinBoxColor(position) {
      if (position === 0) return 'gold';      // Primer lugar - Dorado
      if (position === 1) return 'silver';    // Segundo lugar - Plateado
      if (position === 2) return 'bronze';    // Tercer lugar - Café/Bronce
      return 'white';                        // Demás lugares - Blanco
    }

    function render() {
      // Encontrar el valor máximo actual (del líder)
      const maxValue = Math.max(...countries.map(c => c.v));

      // Obtener número de victorias para cada país
      syncWinsWithCountries();

      // Si es la primera renderización, crear todos los elementos
      if (rowElements.size === 0) {
        countries.forEach((c, idx) => {
          // Calcular el porcentaje en relación a la meta (MAX)
          const percent = Math.min(100, (c.v / MAX) * 100);
          const row = document.createElement("div");
          row.className = "row";
          row.dataset.countryId = c.n;

          const wins = winCounts[c.n] || 0;
          const boxColor = getWinBoxColor(idx);
          const countryGifts = c.gifts || [];

          let giftsHTML = '';
          if (countryGifts.length > 0) {
            countryGifts.forEach((gift, giftIdx) => {
              const giftData = getGiftById(gift.giftId);
              if (giftData) {
                const fallbackAttr = `onerror="if(!this.getAttribute('data-tried-fallback')){this.setAttribute('data-tried-fallback','true');this.src='${giftData.imageUrl}';}"`;
                giftsHTML += `<img src="${giftData.image}" ${fallbackAttr} style="width:24px; height:24px; object-fit:contain; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.8));" alt="">`;
              }
            });
          }

          // Determinar si este país es el máximo ganador de copas
          const maxWinsVal = Math.max(0, ...Object.values(winCounts));
          const isTopWinner = wins > 0 && wins === maxWinsVal;
          const cupClass = isTopWinner ? 'cup-icon top-winner' : 'cup-icon';

          row.innerHTML = `
        <div class="row-left" style="position:absolute; left:0; top:0; height:100%; display:flex; align-items:center; gap:8px; padding-left:10px; z-index:5;">
            ${giftsHTML}
            <img class="flag-img" src="https://flagcdn.com/w40/${c.f}.png" style="width:24px; border-radius:3px; box-shadow:0 0 5px rgba(0,0,0,0.5);">
            <span class="country-name" style="font-weight:900; letter-spacing:1px; font-size:14px; text-transform:uppercase; text-shadow:1px 1px 3px rgba(0,0,0,0.8);">${c.n}</span>
          </div>

          <div class="donor-label" style="left:calc(${Math.max(2, percent - 6)}% + 30px)"></div>
          <div class="bar-wrap">
            <div class="bar" style="background:${c.c};width:${percent}%"></div>
            <img class="runner" src="assets/run.gif" style="left:${Math.max(2, percent - 6)}%" alt="">
          </div>

          <div class="row-right" style="position:absolute; right:0; top:0; height:100%; display:flex; align-items:center; gap:10px; padding-right:10px; font-size:14px; font-weight:bold; z-index:5; text-shadow:1px 1px 3px rgba(0,0,0,0.8); background:linear-gradient(90deg, transparent, rgba(0,0,0,0.3) 20%);">
            <span class="score-text" style="color:rgba(255,255,255,0.7);">${Math.round(c.v)}/${MAX}</span>
            <img class="flag-img-right" src="https://flagcdn.com/w40/${c.f}.png" style="width:18px; border-radius:2px; box-shadow:0 0 5px rgba(0,0,0,0.5);">
            <span class="percent-text" style="color:#38bdf8; min-width:35px; text-align:right;">${Math.round(percent)}%</span>
            <span class="wins-text" style="color:#facc15; display:flex; align-items:center; gap:6px; margin-left:5px;"><span class="${cupClass}">🏆</span> <span class="win-count-num">${wins}</span></span>
          </div>
        </div>
      `;

          track.appendChild(row);
          rowElements.set(c.n, row);
          previousPositions.set(c.n, idx);
        });
      } else {
        // Actualizar elementos existentes con animaciones suaves
        countries.forEach((c, idx) => {
          // Calcular el porcentaje en relación a la meta (MAX)
          const percent = Math.min(100, (c.v / MAX) * 100);
          const row = rowElements.get(c.n);
          const prevPos = previousPositions.get(c.n) ?? idx;

          if (row) {
            // Detectar si el país adelantó a otro (subió de posición)
            if (prevPos > idx) {
              // Agregar efecto de destello
              row.classList.add('passing');
              createSparkles(row, 10);

              // Reproducir sonido de paso
              if (gameStarted) {
                playPassingSound();
              }

              // Remover la clase después de la animación
              setTimeout(() => {
                row.classList.remove('passing');
              }, 600);
            }

            // Actualizar barra de progreso con transición suave
            const bar = row.querySelector('.bar');
            if (bar) {
              bar.style.transition = 'width 0.5s ease-out';
              bar.style.width = `${percent}%`;
            }

            // Actualizar posición de la bandera/corredor con transición
            const runner = row.querySelector('.runner');
            if (runner) {
              runner.style.transition = 'left 0.5s ease-out';
              runner.style.left = `${Math.max(2, percent - 6)}%`;
            }

            // Actualizar posición de etiqueta de donante
            const donorLabel = row.querySelector('.donor-label');
            if (donorLabel) {
              donorLabel.style.transition = 'left 0.5s ease-out';
              donorLabel.style.left = `calc(${Math.max(2, percent - 6)}% + 30px)`;
            }

            // Actualizar textos
            const scoreText = row.querySelector('.score-text');
            if (scoreText) scoreText.textContent = `${Math.round(c.v)}/${MAX}`;

            const percentText = row.querySelector('.percent-text');
            if (percentText) percentText.textContent = `${Math.round(percent)}%`;

            const winsText = row.querySelector('.wins-text');
            const wins = winCounts[c.n] || 0;

            // Determinar si este país es el máximo ganador de copas
            const maxWinsVal = Math.max(0, ...Object.values(winCounts));
            const isTopWinner = wins > 0 && wins === maxWinsVal;
            const cupClass = isTopWinner ? 'cup-icon top-winner' : 'cup-icon';

            if (winsText) winsText.innerHTML = `<span class="${cupClass}">🏆</span> <span class="win-count-num">${wins}</span>`;

            // Actualizar regalos (row-left) — SOLO si cambiaron (evita parpadeo)
            const rowLeft = row.querySelector('.row-left');
            if (rowLeft) {
              const countryGifts = c.gifts || [];
              const newSrcs = countryGifts
                .map(g => { const d = getGiftById(g.giftId); return d ? d.image : null; })
                .filter(Boolean);
              const existingImgs = Array.from(rowLeft.querySelectorAll('img:not(.flag-img)'));
              const existingSrcs = existingImgs.map(img => img.src);
              const changed = newSrcs.length !== existingSrcs.length ||
                newSrcs.some((src, i) => src !== existingSrcs[i]);
              if (changed) {
                existingImgs.forEach(g => g.remove());
                const flagImg = rowLeft.querySelector('.flag-img');
                // Insertar en orden correcto ANTES de la bandera
                newSrcs.forEach((src, i) => {
                  const gift = countryGifts[i];
                  const giftData = gift ? getGiftById(gift.giftId) : null;
                  const img = document.createElement('img');
                  img.src = src;
                  img.onerror = function() {
                    if(!this.getAttribute('data-tried-fallback')) {
                      this.setAttribute('data-tried-fallback', 'true');
                      if(giftData && giftData.imageUrl) this.src = giftData.imageUrl;
                    }
                  };
                  img.style.cssText = 'width:24px;height:24px;object-fit:contain;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.8));';
                  img.alt = '';
                  rowLeft.insertBefore(img, flagImg);
                });
              }
            }

            // Reordenar visualmente usando order CSS
            row.style.order = idx;

            // Actualizar posición anterior
            previousPositions.set(c.n, idx);
          }
        });
      }

      updateGoal();
    }

    function tick() {
      // Reordenar países por valor
      countries.sort((a, b) => b.v - a.v);

      // Sincronizar victorias antes de renderizar
      syncWinsWithCountries();

      // Renderizar cambios
      render();

      // Verificar si alguien ganó
      if (countries[0].v >= MAX) {
        endGame();
      }
    }

    // Inicializar regalo especial (usar el seleccionado por el usuario)
    function initializeSpecialGift() {
      // Verificar que hay regalos cargados
      if (!gifts || gifts.length === 0) {
        console.warn('⚠️ No hay regalos cargados aún, no se puede inicializar el regalo especial');
        const banner = document.getElementById('specialGiftBanner');
        if (banner) banner.style.display = 'none';
        return;
      }

      // Si hay un regalo especial seleccionado, usarlo (desde 200 diamonds)
      if (selectedSpecialGiftId) {
        const gift = getGiftById(selectedSpecialGiftId);
        if (gift && (gift.diamonds || 0) >= 200) {
          specialGift = gift;
          specialGiftCountryIndex = 0;
          console.log(`🎁 Regalo especial: ${specialGift.name} (ID: ${specialGift.giftId})`);

          // Iniciar rotación
          startSpecialGiftRotation();
          updateSpecialGiftBanner();
          return;
        } else if (gift && (gift.diamonds || 0) < 200) {
          // Si el regalo seleccionado no cumple el criterio, limpiarlo
          console.warn(`⚠️ El regalo especial seleccionado (${gift.name}) tiene ${gift.diamonds || 0} diamonds, se requiere mínimo 200. Buscando otro...`);
          selectedSpecialGiftId = null;
          saveSpecialGiftSelection();
        }
      }

      // Si no hay regalo seleccionado, buscar uno que no esté asignado y tenga más de 1000 diamonds
      const assignedGiftIds = new Set();
      countries.forEach(country => {
        if (country.gifts && country.gifts.length > 0) {
          country.gifts.forEach(gift => {
            const cleanedId = cleanGiftId(gift.giftId);
            if (cleanedId !== null) {
              assignedGiftIds.add(cleanedId);
            }
          });
        }
      });

      // Buscar un regalo que NO esté asignado Y tenga mínimo 200 diamonds (fallback)
      const availableGifts = gifts.filter(g => {
        const cleanedId = cleanGiftId(g.giftId);
        return cleanedId !== null && !assignedGiftIds.has(cleanedId) && (g.diamonds || 0) >= 200;
      }).sort((a, b) => (a.diamonds || 0) - (b.diamonds || 0));

      if (availableGifts.length === 0) {
        console.warn('⚠️ No hay regalos disponibles para el regalo especial (requiere mínimo 200 diamonds y no estar asignado)');
        const banner = document.getElementById('specialGiftBanner');
        if (banner) banner.style.display = 'none';
        return;
      }

      // Seleccionar el primer regalo disponible como fallback
      specialGift = availableGifts[0];
      selectedSpecialGiftId = specialGift.giftId;
      saveSpecialGiftSelection();
      specialGiftCountryIndex = 0;

      console.log(`🎁 Regalo especial (fallback): ${specialGift.name} (ID: ${specialGift.giftId})`);

      // Iniciar rotación
      startSpecialGiftRotation();
      updateSpecialGiftBanner();
    }

    // Iniciar rotación del regalo especial
    function startSpecialGiftRotation() {
      // Limpiar intervalos anteriores si existen
      stopSpecialGiftRotation();

      // Resetear timer
      specialGiftTimeLeft = SPECIAL_GIFT_ROTATION_TIME;

      // Actualizar timer cada segundo
      specialGiftTimerInterval = setInterval(() => {
        specialGiftTimeLeft -= 1000;
        if (specialGiftTimeLeft <= 0) {
          specialGiftTimeLeft = SPECIAL_GIFT_ROTATION_TIME;
        }
        updateSpecialGiftTimer();
      }, 1000);

      // Rotar cada 20 segundos
      specialGiftRotationInterval = setInterval(() => {
        rotateSpecialGift();
      }, SPECIAL_GIFT_ROTATION_TIME);

      // Primera rotación inmediata
      rotateSpecialGift();
    }

    // Rotar el regalo especial al siguiente país
    function rotateSpecialGift() {
      if (!specialGift || countries.length === 0) return;

      // Avanzar al siguiente país
      specialGiftCountryIndex = (specialGiftCountryIndex + 1) % countries.length;

      // Resetear timer
      specialGiftTimeLeft = SPECIAL_GIFT_ROTATION_TIME;

      console.log(`🔄 Regalo especial rotado a: ${countries[specialGiftCountryIndex].n}`);

      // Actualizar banner
      updateSpecialGiftBanner();
    }

    // Actualizar banner del regalo especial
    function updateSpecialGiftBanner() {
      const banner = document.getElementById('specialGiftBanner');
      const icon = document.getElementById('specialGiftIcon');
      const name = document.getElementById('specialGiftName');
      const countryFlag = document.getElementById('specialGiftCountryFlag');
      const countryName = document.getElementById('specialGiftCountryName');

      if (!banner || !specialGift) return;

      const country = countries[specialGiftCountryIndex];
      if (!country) {
        banner.style.display = 'none';
        return;
      }

      // Mostrar banner
      banner.style.display = 'flex';

      // Actualizar información
      if (icon) icon.src = specialGift.image;
      if (name) name.textContent = specialGift.name;
      if (countryFlag) countryFlag.src = `https://flagcdn.com/w40/${country.f}.png`;
      if (countryName) countryName.textContent = country.n;

      updateSpecialGiftTimer();
    }

    // Actualizar timer del regalo especial
    function updateSpecialGiftTimer() {
      const timer = document.getElementById('specialGiftTimer');
      if (!timer) return;

      const seconds = Math.ceil(specialGiftTimeLeft / 1000);
      timer.textContent = `Rotando en: ${seconds}s`;
    }

    // Detener rotación del regalo especial
    function stopSpecialGiftRotation() {
      if (specialGiftRotationInterval) {
        clearInterval(specialGiftRotationInterval);
        specialGiftRotationInterval = null;
      }
      if (specialGiftTimerInterval) {
        clearInterval(specialGiftTimerInterval);
        specialGiftTimerInterval = null;
      }
    }

    function startGame() {
      const goalInput = document.getElementById("goalAmount");
      const goalValue = parseInt(goalInput.value);

      // Validar que todos los países tengan al menos un regalo asignado
      const countriesWithoutGift = countries.filter(c => !c.gifts || c.gifts.length === 0);
      if (countriesWithoutGift.length > 0) {
        alert(`⚠️ Por favor asigna al menos un regalo a todos los países.\n\nPaíses sin regalo:\n${countriesWithoutGift.map(c => `- ${c.n}`).join('\n')}`);
        return;
      }

      // Validar que no haya regalos duplicados entre países
      const allGiftIds = [];
      const duplicateGifts = [];

      countries.forEach(country => {
        if (country.gifts && country.gifts.length > 0) {
          country.gifts.forEach(gift => {
            const giftId = cleanGiftId(gift.giftId);
            if (giftId === null) return; // Saltar IDs inválidos
            if (allGiftIds.includes(giftId)) {
              // Encontrar qué país tiene este regalo duplicado
              const duplicateCountry = countries.find(c =>
                c.gifts && c.gifts.some(g => cleanGiftId(g.giftId) === giftId && c.n !== country.n)
              );
              if (duplicateCountry) {
                const giftData = getGiftById(giftId);
                duplicateGifts.push({
                  giftId: giftId,
                  giftName: giftData ? giftData.name : `ID: ${giftId}`,
                  countries: [country.n, duplicateCountry.n]
                });
              }
            } else if (giftId !== null) {
              allGiftIds.push(giftId);
            }
          });
        }
      });

      if (duplicateGifts.length > 0) {
        const duplicateList = duplicateGifts.map(d =>
          `"${d.giftName}" está asignado a: ${d.countries.join(' y ')}`
        ).join('\n');
        alert(`⚠️ Hay regalos duplicados entre países. Cada regalo solo puede estar asignado a UN país.\n\nRegalos duplicados:\n${duplicateList}\n\nPor favor corrige las asignaciones antes de iniciar el juego.`);
        return;
      }

      if (goalValue && goalValue >= 10) {
        MAX = goalValue;
        initAudio(); // Inicializar audio al iniciar el juego

        // No conectar Socket.IO aquí - debe conectarse desde el botón de TikTok

        configModal.style.display = 'none';
        gameContainer.style.display = 'block';
        updateGoal();
        render();

        // Inicializar regalo especial
        initializeSpecialGift();

        // Iniciar el juego automáticamente después de un pequeño delay
        setTimeout(() => {
          start();
        }, 500);
      } else {
        alert('Por favor ingresa una meta válida (mínimo 10,000)');
      }
    }

    function start() {
      if (loop) return;
      gameStarted = true;

      // No conectar Socket.IO aquí - debe conectarse desde el botón de TikTok

      // Loop para actualizar el renderizado y verificar victorias
      // Los puntos solo vienen de los regalos de TikTok recibidos
      loop = setInterval(tick, 200);
    }

    function pause() {
      clearInterval(loop);
      loop = null;
    }

    function reset() {
      pause();
      gameStarted = false;
      countries.forEach(c => {
        c.v = 0;
        c.d = 0;
      });
      rowElements.clear();
      previousPositions.clear();
      track.innerHTML = "";
      finalModal.classList.remove('show');
      goalEl.classList.remove('warning', 'danger');

      // Detener rotación del regalo especial
      stopSpecialGiftRotation();
      specialGift = null;
      const banner = document.getElementById('specialGiftBanner');
      if (banner) banner.style.display = 'none';

      // Regresar al modal de configuración
      gameContainer.style.display = 'none';
      configModal.style.display = 'flex';

      // Limpiar el estado de conexión de TikTok en el modal
      const tiktokStatusEl = document.getElementById('tiktokConnectionStatus');
      if (tiktokStatusEl) {
        tiktokStatusEl.textContent = '';
      }

      // Desconectar socket si está conectado (opcional - puedes comentar esto si quieres mantener la conexión)
      // if(socket && socket.connected){
      //   socket.disconnect();
      //   socket = null;
      // }
    }

    function restartRound() {
      pause();
      gameStarted = false;
      countries.forEach(c => {
        c.v = 0;
        c.d = 0;
      });
      rowElements.clear();
      previousPositions.clear();
      track.innerHTML = "";
      goalEl.classList.remove('warning', 'danger');

      // Reiniciar regalo especial
      initializeSpecialGift();

      render();

      setTimeout(() => {
        start();
      }, 300);
    }

    // Crear contenedor de fuegos artificiales si no existe
    let fireworkContainer = document.querySelector('.firework-container');
    if (!fireworkContainer) {
      fireworkContainer = document.createElement('div');
      fireworkContainer.className = 'firework-container';
      document.body.appendChild(fireworkContainer);
    }

    function createFirework(startX, startY, endX, endY, colors) {
      const colorPalette = colors || [
        ['#22d3ee', '#06b6d4', '#0891b2'],
        ['#6366f1', '#4f46e5', '#4338ca'],
        ['#facc15', '#eab308', '#ca8a04'],
        ['#fb7185', '#f43f5e', '#e11d48'],
        ['#34d399', '#10b981', '#059669'],
        ['#a78bfa', '#8b5cf6', '#7c3aed'],
        ['#fbbf24', '#f59e0b', '#d97706']
      ];

      const palette = colorPalette[Math.floor(Math.random() * colorPalette.length)];
      const mainColor = palette[0];

      // Crear cohete
      const rocket = document.createElement("div");
      rocket.className = "firework-rocket";
      rocket.style.left = `${startX}px`;
      rocket.style.top = `${startY}px`;
      rocket.style.background = `linear-gradient(180deg,${palette[0]},${palette[1]})`;
      rocket.style.boxShadow = `0 0 10px ${palette[0]},0 0 20px ${palette[0]}`;
      fireworkContainer.appendChild(rocket);

      // Crear estela (reducida a 1 para mejor rendimiento)
      const trails = [];
      for (let i = 0; i < 1; i++) {
        const trail = document.createElement("div");
        trail.className = "firework-trail";
        trail.style.left = `${startX}px`;
        trail.style.top = `${startY}px`;
        trail.style.background = `linear-gradient(180deg,transparent,${palette[0]}${Math.floor(60 + i * 10).toString(16)})`;
        fireworkContainer.appendChild(trail);
        trails.push(trail);
      }

      // Animación del cohete subiendo
      const distance = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
      const duration = 800 + Math.random() * 400; // 800-1200ms
      const startTime = Date.now();

      const animateRocket = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Curva de aceleración suave
        const easeOut = 1 - Math.pow(1 - progress, 3);

        const currentX = startX + (endX - startX) * easeOut;
        const currentY = startY + (endY - startY) * easeOut;

        rocket.style.left = `${currentX}px`;
        rocket.style.top = `${currentY}px`;

        // Actualizar estelas
        trails.forEach((trail, idx) => {
          const trailOffset = (idx + 1) * 8;
          trail.style.left = `${currentX}px`;
          trail.style.top = `${currentY + trailOffset}px`;
          trail.style.opacity = 1 - progress * 0.5;
        });

        if (progress < 1) {
          requestAnimationFrame(animateRocket);
        } else {
          // Explosión
          rocket.remove();
          trails.forEach(t => t.remove());

          // Crear explosión central brillante
          const explosion = document.createElement("div");
          explosion.className = "firework-explosion";
          explosion.style.left = `${endX}px`;
          explosion.style.top = `${endY}px`;
          explosion.style.background = mainColor;
          explosion.style.color = mainColor;
          explosion.style.width = '20px';
          explosion.style.height = '20px';
          explosion.style.boxShadow = `0 0 30px ${mainColor},0 0 60px ${mainColor}`;
          fireworkContainer.appendChild(explosion);

          // Animación de la explosión central
          let expSize = 20;
          let expOpacity = 1;
          const animateExplosion = () => {
            expSize += 8;
            expOpacity -= 0.05;
            explosion.style.width = `${expSize}px`;
            explosion.style.height = `${expSize}px`;
            explosion.style.opacity = expOpacity;
            explosion.style.transform = `translate(-50%,-50%)`;

            if (expOpacity > 0) {
              requestAnimationFrame(animateExplosion);
            } else {
              explosion.remove();
            }
          };
          requestAnimationFrame(animateExplosion);

          // Crear partículas de la explosión (mínimo para evitar lag)
          const particleCount = 3 + Math.floor(Math.random() * 3); // 3-6 partículas (muy reducido)

          for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement("div");
            particle.className = "firework-particle";

            // Color aleatorio de la paleta
            const particleColor = palette[Math.floor(Math.random() * palette.length)];
            particle.style.background = particleColor;
            particle.style.color = particleColor;
            particle.style.left = `${endX}px`;
            particle.style.top = `${endY}px`;

            fireworkContainer.appendChild(particle);

            // Ángulo y velocidad aleatorios
            const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5;
            const velocity = 80 + Math.random() * 120;
            const vx = Math.cos(angle) * velocity;
            const vy = Math.sin(angle) * velocity;

            let px = endX;
            let py = endY;
            let opacity = 1;
            let size = 4 + Math.random() * 3;
            let rotation = Math.random() * 360;
            let rotationSpeed = (Math.random() - 0.5) * 10;

            const animateParticle = () => {
              px += vx * 0.08;
              py += vy * 0.08 + 1.5; // gravedad
              opacity -= 0.015;
              size -= 0.03;
              rotation += rotationSpeed;

              particle.style.left = `${px}px`;
              particle.style.top = `${py}px`;
              particle.style.opacity = opacity;
              particle.style.width = `${Math.max(0, size)}px`;
              particle.style.height = `${Math.max(0, size)}px`;
              particle.style.transform = `rotate(${rotation}deg)`;
              particle.style.boxShadow = `0 0 ${size * 2}px ${particleColor}`;

              if (opacity > 0 && size > 0) {
                requestAnimationFrame(animateParticle);
              } else {
                particle.remove();
              }
            };

            // Delay aleatorio para efecto más realista
            setTimeout(() => {
              requestAnimationFrame(animateParticle);
            }, Math.random() * 50);
          }
        }
      };

      requestAnimationFrame(animateRocket);
    }

    function showFireworks() {
      const fireworkCount = 1; // Mínimo: solo un fuego artificial para evitar lag
      const delayBetween = 600; // ms entre cada lanzamiento

      for (let i = 0; i < fireworkCount; i++) {
        setTimeout(() => {
          // Posición inicial desde abajo (centrado en la pantalla)
          const startX = window.innerWidth * 0.5 + (Math.random() - 0.5) * 100;
          const startY = window.innerHeight + 20;

          // Posición final de explosión (centrado en la parte superior)
          const endX = window.innerWidth * 0.5 + (Math.random() - 0.5) * 150;
          const endY = 150 + Math.random() * 100; // Parte superior central

          createFirework(startX, startY, endX, endY);
        }, i * delayBetween);
      }
    }

    function endGame() {
      pause();
      gameStarted = false;

      // Detener rotación del regalo especial
      stopSpecialGiftRotation();

      const winner = countries[0];
      if (winner) {
        winCounts[winner.n] = (winCounts[winner.n] || 0) + 1;
        saveWins();
      }

      // Reproducir sonido de aplausos
      playApplauseSound();

      showFireworks();

      // Mostrar banner del ganador
      const winnerNodeName = document.getElementById("winnerName");
      const winnerNodeWins = document.getElementById("winnerWins");
      const winnerNodeFlag = document.getElementById("winnerFlag");

      if (winner) {
        if (winnerNodeName) winnerNodeName.textContent = winner.n;
        if (winnerNodeWins) winnerNodeWins.textContent = winCounts[winner.n] || 1;
        if (winnerNodeFlag) winnerNodeFlag.src = `https://flagcdn.com/w40/${winner.f}.png`;
      }

      // renderWinsList(); // Obsoleto, ya no se muestran listas, solo el ganador principal

      setTimeout(() => {
        finalModal.classList.add('show');
      }, 500);

      if (restartTimeout) {
        clearTimeout(restartTimeout);
      }
      restartTimeout = setTimeout(() => {
        finalModal.classList.remove('show');
        restartRound();
      }, AUTO_RESTART_DELAY);
    }

    function closeFinal() {
      finalModal.classList.remove('show');
    }

    // Inicializar configuración de regalos
    renderGiftConfig();

    // Inicializar UI de dificultad con valores guardados (localStorage persistente)
    initDifficultyUI();

    // --- LÓGICA DEL HISTORIAL DE CONEXIONES ---
    function showHistoryModal() {
      // Ocultar modal config principal para no superponer si se desea, o dejar ambos
      // document.getElementById('configModal').style.display = 'none';
      document.getElementById('historyModal').style.display = 'flex';
      fetchConnectionHistory();
    }

    function closeHistoryModal() {
      document.getElementById('historyModal').style.display = 'none';
      // document.getElementById('configModal').style.display = 'flex';
    }

    async function fetchConnectionHistory() {
      const container = document.getElementById('historyListContainer');
      container.innerHTML = '<div style="text-align:center; padding:1rem; opacity:0.6;">Cargando historial...</div>';
      
      try {
        const response = await fetch(`${SERVER_BASE_URL}/api/admin/history`);
        if (!response.ok) throw new Error('Error al obtener el historial');
        
        const logs = await response.json();
        
        if (logs.length === 0) {
          container.innerHTML = '<div style="text-align:center; padding:1rem; opacity:0.6;">Aún no hay conexiones registradas hoy.</div>';
          return;
        }

        let html = '<div style="display:flex; flex-direction:column; gap:0.5rem;">';
        
        logs.forEach(log => {
          const isSuccess = log.status === 'success';
          const isBypass = log.type === 'bypass';
          
          const time = new Date(log.timestamp).toLocaleTimeString();
          
          let bgColor = isSuccess ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
          let borderColor = isSuccess ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)';
          let statusIcon = isSuccess ? '✅' : '❌';
          
          // Estilo distintivo para el Bypass
          let typeLabel = isBypass ? '<span style="background:#fbbf24; color:#000; padding:2px 6px; border-radius:4px; font-weight:bold; font-size:0.7rem;">BYPASS SECURE</span>' : '<span style="background:#3b82f6; color:#fff; padding:2px 6px; border-radius:4px; font-weight:bold; font-size:0.7rem;">NATIVE</span>';

          html += `
            <div style="background: ${bgColor}; border: 1px solid ${borderColor}; padding: 0.6rem; border-radius: 8px; font-size: 0.85rem; display:flex; flex-direction:column; gap:0.3rem;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:900; color:#fff;">@${log.username}</span>
                <span style="opacity:0.7; font-size:0.75rem;">${time}</span>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; gap:0.4rem;">
                  ${statusIcon} ${typeLabel}
                </div>
                ${!isSuccess && log.errorMsg ? `<span style="color:#ef4444; font-size:0.75rem; max-width:60%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${log.errorMsg}">Error: ${log.errorMsg}</span>` : ''}
              </div>
            </div>
          `;
        });
        
        html += '</div>';
        container.innerHTML = html;
        
      } catch (err) {
        container.innerHTML = `<div style="text-align:center; padding:1rem; color:#ef4444;">Error al conectar con Render API: ${err.message}</div>`;
      }
    }

    // Modos de Vista
    function setViewMode(mode) {
      const game = document.getElementById('gameContainer');
      const btnTikTok = document.getElementById('btnTikTokMode');
      const btnPC = document.getElementById('btnPCMode');

      if (mode === 'pc') {
        game.classList.add('pc-mode');
        game.classList.remove('tiktok-mode');
        btnPC.classList.add('active');
        btnTikTok.classList.remove('active');
      } else {
        game.classList.remove('pc-mode');
        game.classList.add('tiktok-mode');
        btnTikTok.classList.add('active');
        btnPC.classList.remove('active');
      }
    }

    // NO conectar Socket.IO automáticamente - solo cuando el usuario presione "Conectar a TikTok Live"
  