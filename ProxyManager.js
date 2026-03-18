const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');

/**
 * Gestor Avanzado de Proxies Rotativos (Nivel 3)
 * Descarga listas de proxies gratuitos y los rota si la conexión de TikTok falla.
 */
class ProxyManager {
    constructor() {
        this.proxies = [];
        this.currentProxyIndex = 0;
        
        // Fuentes de listas de proxies gratuitos (HTTP/HTTPS)
        // Scrapea Proxies de alto anonimato (Elite) para engañar mejor a TikTok
        this.sources = [
            'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=all&ssl=all&anonymity=elite',
            'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt'
        ];
    }

    /**
     * Descarga y valida cientos de proxies gratuitos
     */
    async fetchFreeProxies() {
        console.log("🌍 [ProxyManager] Descargando listas de proxies gratuitas mundiales...");
        this.proxies = [];
        
        for (const url of this.sources) {
            try {
                const response = await axios.get(url, { timeout: 10000 });
                const lines = response.data.split('\n');
                
                for (const line of lines) {
                    const proxy = line.trim();
                    if (proxy && proxy.includes(':')) {
                        // Agregar el protocolo http:// a los proxies
                        this.proxies.push(proxy.startsWith('http') ? proxy : `http://${proxy}`);
                    }
                }
            } catch (err) {
                console.warn(`⚠️ [ProxyManager] Error obteniendo proxies de ${url}: ${err.message}`);
            }
        }
        
        // Mezclar aleatoriamente (Shuffle)
        this.proxies = this.proxies.sort(() => Math.random() - 0.5);
        console.log(`✅ [ProxyManager] ¡Se cargaron ${this.proxies.length} proxies gratuitos listos para rotar!`);
    }

    /**
     * Devuelve el agente proxy actual para inyectarlo en tiktok-live-connector
     */
    getNextProxyAgent() {
        if (this.proxies.length === 0) {
            return null; // Si no hay proxies, retorna null para conexión directa
        }

        // Rotar al siguiente proxy cíclicamente
        const proxyUrl = this.proxies[this.currentProxyIndex];
        this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
        
        console.log(`🔄 [ProxyManager] Usando Nuevo Proxy: ${proxyUrl}`);
        
        if (proxyUrl.startsWith('https')) {
             return new HttpsProxyAgent(proxyUrl);
        } else {
             return new HttpProxyAgent(proxyUrl);
        }
    }

    /**
     * Permite agregar un proxy Premium (comprado) manualmente
     */
    addPremiumProxy(proxyUrl) {
        this.proxies.unshift(proxyUrl);
        console.log(`💎 [ProxyManager] Proxy Premium registrado exitosamente.`);
    }
}

module.exports = ProxyManager;
