const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const qs = require('qs');
const puppeteer = require('puppeteer');
const base64 = require('base-64');
const utf8 = require('utf8');
const { SocksProxyAgent } = require('socks-proxy-agent');
const ProxyManager = require('./ProxyManager');

const ACCOUNTS_DIR = path.join(__dirname, '../../accounts');

const CLIENT_ID = "54fd49e4-2103-4044-9603-2b028c814ec3";
const OAUTH20_TOKEN_LINK = "https://login.live.com/oauth20_token.srf";
const XBL_LINK = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_LINK = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_SERVICES_LINK = "https://api.minecraftservices.com/authentication/login_with_xbox";
const OWNERSHIP_LINK = "https://api.minecraftservices.com/entitlements/mcstore";
const PROFILE_LINK = "https://api.minecraftservices.com/minecraft/profile";

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Promise Rejection:', reason);
});

class AccountManager {

    static loadAccountsByType(accountType) {
        const accountFiles = fs.readdirSync(ACCOUNTS_DIR).filter(file => {
            if (accountType === 'microsoft' && file.endsWith('.json')) {
                const accountData = JSON.parse(fs.readFileSync(path.join(ACCOUNTS_DIR, file), 'utf-8'));
                return accountData.type === accountType;
            } else if (accountType === 'cookie' && file.endsWith('.txt')) {
                return true;
            }
            return false;
        });

        return accountFiles.map(file => {
            if (accountType === 'microsoft') {
                const accountData = JSON.parse(fs.readFileSync(path.join(ACCOUNTS_DIR, file), 'utf-8'));
                return { file, type: accountData.type };
            } else if (accountType === 'cookie') {
                return { file, type: 'cookie' };
            }
        });
    }

    static async deleteAccount(file) {
        try {
            const accountFilePath = path.join(ACCOUNTS_DIR, file);
            if (fs.existsSync(accountFilePath)) {
                await fs.promises.unlink(accountFilePath);
                console.log(`Account file ${file} deleted successfully.`);
            } else {
                console.log(`No account file found for ${file}.`);
            }
        } catch (error) {
            console.error(`Error deleting account file ${file}: ${error.message}`);
        }
    }

    static async login(accountObj) {
        const { file, type } = accountObj;
    
        if (type === 'microsoft') {
            return await AccountManager.loginMicrosoft(file);
        } else if (type === 'cookie') {
            const netscapeCookiesPath = path.join(ACCOUNTS_DIR, file);
            if (fs.existsSync(netscapeCookiesPath)) {
                const netscapeCookies = fs.readFileSync(netscapeCookiesPath, 'utf-8');
                console.log(`Found cookies for ${file}`);
                return await AccountManager.loginWithCookieAlt(netscapeCookies);
            } else {
                console.log(`No cookie file found for ${file}.`);
                return { success: false, reason: `Cookie file not found: ${file}` };
            }
        } else {
            return { success: false, reason: `Unknown account type: ${type}` };
        }
    }

    static async loginMicrosoft(file) {
        const accountFilePath = path.join(ACCOUNTS_DIR, file);
    
        if (fs.existsSync(accountFilePath)) {
            const accountData = JSON.parse(fs.readFileSync(accountFilePath, 'utf-8'));
    
            if (Date.now() >= accountData.expiresAt) {
                console.log(`Access token for ${file} has expired, refreshing...`);
                const refreshedProfile = await AccountManager.refreshTokens(accountData.refreshToken);
    
                if (refreshedProfile.success) {
                    await AccountManager.storeProfile(refreshedProfile.profile);
                    return { success: true, profile: refreshedProfile.profile };
                } else {
                    return { success: false, reason: refreshedProfile.reason };
                }
            } else {
                console.log(`Access token for ${file} is still valid.`);
                return { success: true, profile: accountData };
            }
        } else {
            console.log(`No account found for ${file}, starting a new login process...`);
            const profileResponse = await AccountManager.startServer();
            if (profileResponse.success) {
                await AccountManager.storeProfile(profileResponse.profile);
                return { success: true, profile: profileResponse.profile };
            } else {
                return { success: false, reason: profileResponse.reason };
            }
        }
    }

    static startServer() {
        return new Promise((resolve) => {
            const app = express();
            app.use(bodyParser.urlencoded({ extended: false }));
    
            const server = app.listen(0, async () => {
                const port = server.address().port;
                const redirectUri = `http://localhost:${port}`;
                const refreshTokenLink = `https://login.live.com/oauth20_authorize.srf?client_id=${CLIENT_ID}&response_type=code&scope=XboxLive.signin%20XboxLive.offline_access&redirect_uri=${encodeURIComponent(redirectUri)}&prompt=select_account`;
    
                const result = await openLoginPage(refreshTokenLink);
                if (!result) {
                    console.error("Failed to open login page.");
                    server.close();
                    return resolve({ success: false, reason: "Failed to open login page." });
                }
    
                const browser = result.browser;
    
                app.get('/', async (req, res) => {
                    const code = req.query.code;
                    if (!code) {
                        res.send("Authentication failed.");
                    } else {
                        try {
                            const profile = await AccountManager.handleCode(code, redirectUri);
                            profile.profile.type = "microsoft";
                            res.send("<html>You may now close this page.<script>window.close()</script></html>");
                            resolve({ success: true, profile: profile.profile });
                        } catch (error) {
                            res.send("Authentication error.");
                            console.error("Error while handling code:", error);
                            resolve({ success: false, reason: error.message });
                        } finally {
                            await browser.close();
                            server.close();
                        }
                    }
                });
    
                browser.on('disconnected', async () => {
                    resolve({ success: false, reason: "Browser was closed before authentication." });
                    server.close();
                });
            });
        });
    }
    
    static async handleCode(code, redirectUri) {
        try {
            const proxy = await ProxyManager.getRandomProxy();
        
            if (!proxy) {
                throw new Error("No valid proxy available.");
            }
        
            const proxyRequest = axios.create({
                httpsAgent: new SocksProxyAgent(
                    `socks5://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
                ),
                rejectUnauthorized: false
            });
        
            const data = {
                client_id: CLIENT_ID,
                redirect_uri: redirectUri,
                grant_type: "authorization_code",
                code: code
            };
        
            const response = await proxyRequest.post(OAUTH20_TOKEN_LINK, qs.stringify(data), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
        
            if (!response.data || !response.data.refresh_token) {
                return { success: false, reason: "Failed to get token." };
            }
        
            const profile = await AccountManager.retrieveGameProfile(response.data.access_token, proxyRequest);
            if (!profile.success) {
                return { success: false, reason: profile.reason };
            }
        
            profile.refreshToken = response.data.refresh_token;
        
            return { success: true, profile: profile };
        } catch (error) {
            console.error("Error in handleCode:", error);
            return { success: false, reason: `handleCode error: ${error.message}` };
        }
    }

    static async refreshTokens(refreshToken) {
        try {
            const proxy = await ProxyManager.getRandomProxy();
        
            if (!proxy) {
                throw new Error("No valid proxy available.");
            }
        
            const proxyRequest = axios.create({
                httpsAgent: new SocksProxyAgent(
                    `socks5://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
                ),
                rejectUnauthorized: false
            });
    
            const data = {
                client_id: CLIENT_ID,
                refresh_token: refreshToken,
                grant_type: "refresh_token"
            };
    
            const response = await proxyRequest.post(OAUTH20_TOKEN_LINK, qs.stringify(data), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
    
            if (!response.data || !response.data.refresh_token || !response.data.access_token) {
                return { success: false, reason: 'Failed to retrieve new access token and refresh token from the response.' };
            }
    
            const profile = await AccountManager.retrieveGameProfile(response.data.access_token, proxyRequest);
            if (!profile.success) {
                return { success: false, reason: profile.reason };
            }
    
            profile.refreshToken = response.data.refresh_token;
    
            return {
                success: true,
                profile: {
                    type: "microsoft",
                    hasGame: profile.hasGame,
                    name: profile.name,
                    uuid: profile.uuid,
                    accessToken: profile.accessToken,
                    expiresAt: profile.expiresAt,
                    refreshToken: profile.refreshToken
                }
            };
        } catch (error) {
            return { success: false, reason: `Error during token refresh: ${error.message}` };
        }
    }

    static async retrieveGameProfile(microsoftToken, proxyRequest) {
        try {
            if (!microsoftToken) {
                return { success: false, reason: "No Microsoft token provided." };
            }
    
            const xblData = await AccountManager.getXboxLiveResponse(microsoftToken, proxyRequest);
            if (!xblData.success) return xblData;
    
            const XSTSToken = await AccountManager.getXstsToken(xblData.data.xblToken, proxyRequest);
            if (!XSTSToken.success) return XSTSToken;
    
            const tokenRes = await AccountManager.getAccessToken(xblData.data.userHash, XSTSToken.data, proxyRequest);
            if (!tokenRes.success) return tokenRes;
    
            const gameOwnership = await AccountManager.checkOwnership(tokenRes.data.accessToken, proxyRequest);
            const gameProfile = await AccountManager.getUuidName(tokenRes.data.accessToken, proxyRequest);
    
            return {
                success: gameOwnership.success && gameOwnership.data && gameProfile.data?.name != null && gameProfile.data?.uuid != null && tokenRes.data.accessToken != null,
                hasGame: gameOwnership.data ?? false,
                name: gameProfile.data?.name ?? null,
                uuid: gameProfile.data?.uuid ?? null,
                accessToken: tokenRes.data.accessToken ?? null,
                expiresAt: tokenRes.data.expiresAt ?? -1
            };
        } catch (error) {
            return { success: false, reason: `retrieveGameProfile error: ${error.message}` };
        }
    }

    static async getXboxLiveResponse(accessToken, proxyRequest) {
        try {
            const body = {
                Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: "d=" + accessToken },
                RelyingParty: "http://auth.xboxlive.com",
                TokenType: "JWT"
            };
            const response = await proxyRequest.post(XBL_LINK, body);
            return { success: true, data: { xblToken: response.data.Token, userHash: response.data.DisplayClaims.xui[0].uhs } };
        } catch (error) {
            return { success: false, reason: `getXboxLiveResponse error: ${error.message}`, code: error.code };
        }
    }

    static async getXstsToken(xblToken, proxyRequest) {
        try {
            const body = {
                Properties: { SandboxId: "RETAIL", UserTokens: [xblToken] },
                RelyingParty: "rp://api.minecraftservices.com/",
                TokenType: "JWT"
            };
            const response = await proxyRequest.post(XSTS_LINK, body);
            return { success: true, data: response.data.Token };
        } catch (error) {
            return { success: false, reason: `getXstsToken error: ${error.message}`, code: error.code };
        }
    }

    static async getAccessToken(userHash, xstsToken, proxyRequest) {
        try {
            const body = { "identityToken": `XBL3.0 x=${userHash};${xstsToken}` };
            const response = await proxyRequest.post(MC_SERVICES_LINK, body, { headers: { 'Content-Type': 'application/json' } });
            return { success: true, data: { accessToken: response.data.access_token, expiresAt: Date.now() + response.data.expires_in * 1000 } };
        } catch (error) {
            return { success: false, reason: `getAccessToken error: ${error.message}`, code: error.code };
        }
    }

    static async checkOwnership(javaToken, proxyRequest) {
        try {
            const headers = { 'Authorization': `Bearer ${javaToken}` };
            const gameOwnershipResponse = await proxyRequest.get(OWNERSHIP_LINK, { headers });
            const hasGameOwnership = AccountManager.hasGameOwnership(gameOwnershipResponse.data.items);
            return { success: true, data: hasGameOwnership };
        } catch (error) {
            return { success: false, reason: `checkOwnership error: ${error.message}`, code: error.code };
        }
    }

    static async getUuidName(javaToken, proxyRequest) {
        try {
            const headers = { 'Authorization': `Bearer ${javaToken}` };
            const profileResponse = await proxyRequest.get(PROFILE_LINK, { headers });
            return { success: true, data: { uuid: profileResponse.data.id, name: profileResponse.data.name } };
        } catch (error) {
            return { success: false, reason: `getUuidName error: ${error.message}`, code: error.code };
        }
    }

    static hasGameOwnership(items) {
        let hasProduct = false;
        let hasGame = false;
        for (let item of items) {
            if (item.name === "product_minecraft") hasProduct = true;
            else if (item.name === "game_minecraft") hasGame = true;
        }
        return hasProduct && hasGame;
    }

    static async storeProfile(profile) {
        if (!fs.existsSync(ACCOUNTS_DIR)) {
            fs.mkdirSync(ACCOUNTS_DIR);
        }
    
        if (profile.hasOwnProperty('success')) {
            delete profile.success;
        }
    
        const filePath = path.join(ACCOUNTS_DIR, `${profile.name}.json`);
        await fs.promises.writeFile(filePath, JSON.stringify(profile, null, 4), 'utf-8');
    }

    static async loginWithCookieAlt(netscapeCookies) {
        try {
            const cookies = AccountManager.parseNETSCAPEFile(netscapeCookies);
            const cookieHeader = AccountManager.buildCookieHeader(cookies);
            const tokenData = await AccountManager.loginCookie(cookieHeader);
            if (tokenData.success) {
                return { success: true, profile: tokenData };
            } else {
                return { success: false, reason: tokenData.reason };
            }
        } catch (error) {
            console.error(error);
            return { success: false, reason: `loginWithCookieAlt error: ${error.message}` };
        }
    }

    static buildCookieHeader(cookies) {
        return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    }

    static async loginCookie(cookieHeader) {
        try {
            const initialUrl = 'https://sisu.xboxlive.com/connect/XboxLive/?state=login&cobrandId=8058f65d-ce06-4c30-9559-473c9275a65d&tid=896928775&ru=https%3A%2F%2Fwww.minecraft.net%2Fen-us%2Flogin&aid=1142970254';
            const commonHeaders = {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cookie': cookieHeader,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36'
            };
    
            const proxy = await ProxyManager.getRandomProxy();
            
            if (!proxy) {
                throw new Error("No valid proxy available.");
            }
    
            const proxyRequest = axios.create({
                httpsAgent: new SocksProxyAgent(`socks5://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`),
                rejectUnauthorized: false
            });
    
            const firstLocation = await AccountManager.fetchLocation(initialUrl, commonHeaders, proxyRequest);
            if (!firstLocation) return { success: false, reason: "Failed on step: 1" };
    
            const secondLocation = await AccountManager.fetchLocation(firstLocation, commonHeaders, proxyRequest);
            if (!secondLocation) return { success: false, reason: "Account is locked" };
    
            const thirdLocation = await AccountManager.fetchLocation(secondLocation, commonHeaders, proxyRequest);
            if (!thirdLocation) return { success: false, reason: "Failed on step: 3" };
    
            const { token, uhs } = AccountManager.parseAccessToken(thirdLocation);
            if (!token || !uhs) return { success: false, reason: "Internal server error while parsing token" };
    
            const tokenRes = await AccountManager.getAccessToken(uhs, token, proxyRequest);
            if (!tokenRes.success) return { success: false, reason: "Failed to fetch java token" };
    
            const gameOwnership = await AccountManager.checkOwnership(tokenRes.data.accessToken, proxyRequest);
            const gameProfile = await AccountManager.getUuidName(tokenRes.data.accessToken, proxyRequest);
    
            return {
                success: true,
                hasGame: gameOwnership.data ?? false,
                name: gameProfile.data?.name ?? null,
                uuid: gameProfile.data?.uuid ?? null,
                accessToken: tokenRes.data.accessToken ?? null,
                expiresAt: tokenRes.data.expiresAt ?? -1
            };
        } catch (error) {
            return { success: false, reason: `loginCookie error: ${error.message}` };
        }
    }
    
    static async fetchLocation(url, headers = {}, proxyRequest) {
        try {
            const response = await proxyRequest.get(url, {
                headers,
                maxRedirects: 0,
                validateStatus: function (status) {
                    return status >= 300 && status < 400;
                }
            });
    
            return response.headers.location;
        } catch (error) {
            return null;
        }
    }

    static parseAccessToken(url) {
        const accessTokenHash = url.split("accessToken=")[1];
        if (accessTokenHash) {
            const decoded = utf8.decode(base64.decode(accessTokenHash)).split('"rp://api.minecraftservices.com/",')[1];
            const token = decoded.split('"Token":"')[1].split('"')[0];
            const uhs = decoded.split('{"DisplayClaims":{"xui":[{"uhs":"')[1].split('"')[0];
            return { token, uhs };
        }
        return null;
    }

    static parseNETSCAPEFile(netscapeCookies) {
        let lines = netscapeCookies.split(/\r\n|\n/);
        let cookies = [];

        for (let line of lines) {
            let parts = line.split('\t').map(part => part.trim());

            if (parts.length !== 7 || parts[0].startsWith('#')) continue;

            let [domain, , path, secureFlag, expires, name, value] = parts;

            if (domain.charCodeAt(0) === 0xFEFF) {
                domain = domain.slice(1);
            }
            domain = domain.replace(/[^\x20-\x7E]/g, '');

            let cookie = {
                domain,
                path,
                secure: secureFlag.toLowerCase() === 'true',
                name,
                value,
                sameSite: 'Lax'
            };

            if (cookie.name.startsWith('__Host-')) {
                cookie.secure = true;
            }

            if (expires !== "0") {
                let expirationDate = parseInt(expires, 10);
                if (!isNaN(expirationDate)) {
                    cookie.expires = expirationDate * 1000;
                }
            }

            if (cookie.sameSite === 'Norestriction') {
                cookie.sameSite = 'None';
            }

            cookies.push(cookie);
        }
        return cookies;
    }
}

async function openLoginPage(url) {
    const proxy = await ProxyManager.getRandomProxy();

    if (!proxy) {
        console.error('No valid proxies available.');
        return null;
    }

    let browser;

    try {
        browser = await puppeteer.launch({
            headless: false,
            args: [
                `--proxy-server=${proxy.host}:${proxy.port}`,
                '--window-size=800,690'
            ]
        });

        const page = await browser.newPage();

        await page.authenticate({
            username: proxy.username,
            password: proxy.password
        });

        await page.goto(url);

        return { browser, page };
    } catch (err) {
        console.error('Error during page setup or navigation:', err);
        
        if (browser) {
            await browser.close();
        }

        return null;
    }
}

module.exports = AccountManager;