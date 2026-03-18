const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

/**
 * Módulo Avanzado de Firmas de TikTok (VPS Headless)
 * Este módulo abrirá un navegador Chrome invisible para dejar que el código oficial 
 * de TikTok calcule el X-Bogus, luego interceptará la firma y cerrará el navegador.
 */
class PrivateSigner {
    constructor() {
        this.browser = null;
        this.isReady = false;
        
        // El ejecutable de Chrome del VPS (Linux/Windows)
        this.executablePath = this.findLocalChrome();
    }

    findLocalChrome() {
        const paths = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser'
        ];
        const fs = require('fs');
        for (const p of paths) {
            if (fs.existsSync(p)) return p;
        }
        return null;
    }

    /**
     * Inicia el navegador invisible.
     * Solo debe llamarse cuando fallan los otros métodos (Nivel 2)
     */
    async init() {
        if (!this.executablePath) {
            throw new Error("❌ No se encontró Google Chrome instalado en el VPS. Instálalo primero.");
        }
        
        console.log("👻 [PrivateSigner] Iniciando Chrome Headless Invisible...");
        this.browser = await puppeteer.launch({
            executablePath: this.executablePath,
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--mute-audio' // Silenciar videos de tiktok
            ]
        });
        this.isReady = true;
    }

    /**
     * Roba las firmas pidiendo al navegador que se conecte a la página del creador.
     * @param {string} username - Nombre de usuario de TikTok (ej. @creador)
     */
    async stealSignatures(username) {
        if (!this.isReady) await this.init();

        console.log(`🕵️ [PrivateSigner] Infiltrándose en la sala de @${username} para interceptar X-Bogus...`);
        const page = await this.browser.newPage();
        
        let interceptedUrl = null;
        let interceptedHeaders = null;

        // Activar interceptación de red para espiar el generador de TikTok
        await page.setRequestInterception(true);

        // Promesa para esperar el X-Bogus
        const signaturePromise = new Promise((resolve, reject) => {
            page.on('request', request => {
                const url = request.url();
                
                // TikTok hace la conexión a un imapi/webcast, que es donde firman el X-Bogus
                if (url.includes('im/fetch') || url.includes('/webcast/room/')) {
                    if (url.includes('X-Bogus') || url.includes('msToken')) {
                        interceptedUrl = url;
                        interceptedHeaders = request.headers();
                        resolve({
                            url: interceptedUrl,
                            headers: interceptedHeaders
                        });
                    }
                }
                request.continue();
            });

            // Timeout de 15 segundos maximo
            setTimeout(() => {
                if (!interceptedUrl) reject(new Error("Timeout robando firmas"));
            }, 15000);
        });

        try {
            // Entrar como un usuario fantasma
            await page.goto(`https://www.tiktok.com/@${username}/live`, { 
                waitUntil: 'networkidle2', 
                timeout: 20000 
            });

            const signatures = await signaturePromise;
            console.log(`✅ [PrivateSigner] ¡Firma interceptada con éxito!`);
            
            // Cerrar la pestaña inmediatamente para ahorrar RAM del VPS
            await page.close();
            return signatures;

        } catch (error) {
            console.error(`❌ [PrivateSigner] Falló la infiltración:`, error.message);
            await page.close();
            throw error;
        }
    }

    /**
     * Cierra el navegador por completo para no dejar procesos zombis en el VPS
     */
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.isReady = false;
        }
    }
}

module.exports = PrivateSigner;
