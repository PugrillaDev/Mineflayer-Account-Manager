const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');

const PROXIES_FILE = path.join(__dirname, '../../proxies.txt');

class ProxyManager {

    static loadProxies() {
        if (!fs.existsSync(PROXIES_FILE)) {
            console.log('No proxies.txt file found. Creating a new one.');
            fs.writeFileSync(PROXIES_FILE, '');
            return [];
        }

        const proxies = fs.readFileSync(PROXIES_FILE, 'utf-8')
            .trim()
            .split('\n')
            .map(proxy => proxy.replace(/\r$/, ''));

        return proxies.filter(proxy => proxy);
    }

    static saveProxies(proxies) {
        fs.writeFileSync(PROXIES_FILE, proxies.join('\n'), 'utf-8');
    }

    static async validateProxy(proxy, apis = ['https://api.ipify.org', 'https://checkip.amazonaws.com', 'https://ip.seeip.org']) {
        const [host, port, username, password] = proxy.split(":").map(p => p.trim());
        const agent = new SocksProxyAgent(`socks5://${username}:${password}@${host}:${port}`);

        const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));

        try {
            await Promise.any(apis.map(api =>
                Promise.race([
                    axios.get(api, { httpAgent: agent, httpsAgent: agent }),
                    timeout(15000)
                ])
            ));
            return true;
        } catch {
            return false;
        }
    }

    static async getRandomProxy() {
        const proxies = ProxyManager.loadProxies();
        if (proxies.length === 0) {
            console.log('No proxies available.');
            return null;
        }
    
        const proxyString = proxies[Math.floor(Math.random() * proxies.length)];
        const [host, port, usernameProxy, passwordProxy] = proxyString.split(":");
        
        if (!host || !port) {
            console.log('Invalid proxy format.');
            ProxyManager.removeProxy(proxyString);
            return ProxyManager.getRandomProxy();
        }
    
        const isValid = await ProxyManager.validateProxy(proxyString);
        if (isValid) {
            return {
                protocol: 5,
                host,
                port: parseInt(port, 10),
                username: usernameProxy || null,
                password: passwordProxy || null,
                string: proxyString
            };
        } else {
            console.log(`Invalid proxy, removing: ${proxyString}`);
            ProxyManager.removeProxy(proxyString);
            return ProxyManager.getRandomProxy();
        }
    }
    
    static parseProxyString(proxyString) {
        const [host, port, usernameProxy, passwordProxy] = proxyString.split(":");
    
        if (!host || !port) {
            throw new Error("Invalid proxy string format. Expected format: 'host:port:username:password'.");
        }
    
        return {
            host,
            port: parseInt(port, 10),
            usernameProxy: usernameProxy || null,
            passwordProxy: passwordProxy || null
        };
    }

    static removeProxy(proxy) {
        let proxies = ProxyManager.loadProxies();
        proxies = proxies.filter(p => p !== proxy);
        ProxyManager.saveProxies(proxies);
    }
}

module.exports = ProxyManager;