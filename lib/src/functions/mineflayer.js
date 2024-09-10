process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const mineflayer = require("mineflayer");
const server = require('../constants/serverInfo');
const socks = require('socks').SocksClient;
const ProxyAgent = require('proxy-agent');
const ProxyManager = require('../utils/ProxyManager');
const AccountManager = require('../utils/AccountManager');
const { addBot, removeBot, updateBot, getTargetLocations, getLocation } = require('../utils/BotAPI');
const readline = require('readline');

const bots = [];

async function startBot(accountObj) {
    const chalk = (await import('chalk')).default;

    const validatedAccount = await AccountManager.login(accountObj);
    if (!validatedAccount.success || !validatedAccount.profile) {
        if (accountObj.type === "cookie" && validatedAccount.reason.includes("Account is locked")) {
            AccountManager.deleteAccount(accountObj.file);
            console.log(chalk.gray('[') + chalk.green('Autobot') + chalk.gray('] ') + chalk.green(accountObj.file) + chalk.yellow(' is ') + chalk.red("locked") + chalk.yellow('. Removing account.'));
            return;
        }

        console.log(chalk.gray('[') + chalk.green('Autobot') + chalk.gray('] ') + chalk.yellow(`Failed to login to `) + chalk.green(accountObj.file) + chalk.yellow(`.`) + chalk.red(` ${validatedAccount.reason}`));
    }

    const proxy = await ProxyManager.getRandomProxy();
    if (!proxy) {
        console.log(chalk.gray('[') + chalk.green('Autobot') + chalk.gray('] ') + chalk.yellow(`Auto Queueing mode is `) + chalk.green('disabled.'));
        return;
    }

    const account = validatedAccount.profile;
    if (accountObj.type === "microsoft" && account?.name.startsWith("random")) {
        accountObj.file = `${account.name}.json`;
    }
    let restartInitiated = false;
    let ticks = 0;

    let bot = mineflayer.createBot({
        host: server.host,
        username: account.name,
        port: server.port,
        version: server.version,
        viewDistance: server.viewDistance,
        auth: server.auth,
        skipValidation: true,
        session: {
            accessToken: account.accessToken,
            clientToken: account.uuid,
            selectedProfile: {
                id: account.uuid,
                name: account.name
            }
        },
        agent: new ProxyAgent(`socks5://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`),
        connect: (client) => {
            socks.createConnection({
                proxy: {
                    host: proxy.host,
                    port: proxy.port,
                    type: 5,
                    userId: proxy.username,
                    password: proxy.password,
                },
                command: 'connect',
                destination: {
                    host: server.host,
                    port: server.port
                }
            }, (err, info) => {
                if (err) {
                    console.log(chalk.gray('[') + chalk.green('Autobot') + chalk.gray('] ') + chalk.yellow(`${account.name} had an error connecting with proxy: `) + chalk.red(err.message));
                    setTimeout(() => startBot(accountObj), 5000);
                    return;
                }
                client.setSocket(info.socket);
                client.emit('connect');
            });
        }
    });

    bots.push(bot);

    bot.once("spawn", async () => {
        console.log(chalk.gray('[') + chalk.green('Autobot') + chalk.gray('] ') + chalk.yellow(`${account.name} logged into `) + chalk.green(server.host) + chalk.yellow("."));
        addBot({
            uuid: account.uuid,
            name: account.name,
            location: null
        });
    });

    bot.on("spawn", async () => {
        await sleep(1000);
        bot.chat("/locraw");
        checkingForTarget = false;
    });

    bot.on("message", async (chatMsg) => {
        const msg = chatMsg.toString();
        if (msg.startsWith("{") && msg.endsWith("}")) {
            const locraw = JSON.parse(msg);
            updateBot(account.uuid, { location: locraw });
        }
    });

    bot.on('physicsTick', () => {
        ticks++;
    });

    const removeBotFromList = () => {
        const index = bots.indexOf(bot);
        if (index > -1) {
            bots.splice(index, 1);
        }
    };

    bot.on("end", async (reason) => {
        removeBot(account.uuid);
        removeBotFromList();

        await sleep(2000);

        if (!restartInitiated) {
            console.log(chalk.gray('[') + chalk.green('Autobot') + chalk.gray('] ') + chalk.yellow(`${account.name} ended: `) + chalk.red(reason));
            restartInitiated = true;
            setTimeout(() => startBot(accountObj), 5000);
        }
    });

    bot.on('kicked', async (reason) => {
        removeBot(account.uuid);
        if (reason.includes("banned")) {
            console.log(chalk.gray('[') + chalk.green('Autobot') + chalk.gray('] ') + chalk.green(account.name) + chalk.yellow(' was banned for ') + chalk.red(getBanReason(reason)) + chalk.yellow('. Removing account and proxy.'));
            AccountManager.deleteAccount(accountObj.file);
            ProxyManager.removeProxy(proxy.string);
            restartInitiated = true;
            removeBotFromList();
            return;
        }

        console.log(chalk.gray('[') + chalk.green('Autobot') + chalk.gray('] ') + chalk.yellow(`${account.name} was kicked: `) + chalk.red(JSON.stringify(reason, null, 4)));

        removeBotFromList();

        if (!restartInitiated) {
            restartInitiated = true;
            setTimeout(() => startBot(accountObj), 5000);
        }
    });

    bot.on("error", async (err) => {
        removeBotFromList();
        removeBot(account.uuid);
        if (err.code === "ERR_INVALID_ARG_TYPE" && err.field === "login.toServer") {
            console.log(chalk.gray('[') + chalk.green('Autobot') + chalk.gray('] ') + chalk.red(`${account.name} had an error: ${err.message}`));
            console.log(chalk.gray('[') + chalk.green('Autobot') + chalk.gray('] ') + chalk.yellow(`Profile: ${JSON.stringify(account, null, 2)}`));
            console.log(chalk.gray('[') + chalk.green('Autobot') + chalk.gray('] ') + chalk.yellow(`Account file: ${accountObj.file}`));
            return;
        }
    
        console.log(chalk.gray('[') + chalk.green('Autobot') + chalk.gray('] ') + chalk.red(`${account.name} had an error: ${JSON.stringify(err)}`));
    
        await sleep(1000);
    
        if (!restartInitiated) {
            restartInitiated = true;
            setTimeout(() => startBot(accountObj), 5000);
        }
    });
}

async function startBots(usernames) {
    await Promise.all(usernames.map(username => startBot(username)));

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.on('line', (input) => {
        bots.forEach((bot, index) => {
            try {
                if (bot && bot.chat) {
                    bot.chat(input);
                } else {
                    throw new Error('bot._client.chat is not a function');
                }
            } catch (err) {
                if (err.message.includes('bot._client.chat is not a function')) {
                    bots.splice(index, 1);
                }
            }
        });
    });
}

function getBanReason(kick) {
    const lower = kick.toLowerCase();
    if (lower.includes("suspicious") || lower.includes("security")) {
        return "Suspicious Activity";
    } else if (lower.includes("boosting")) {
        return "Boosting";
    } else if (lower.includes("cheating")) {
        return "Cheating";
    } else {
        return kick;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getScoreboardLines(scoreboard) {
    const extractTextFromItem = (item) => {
        let text = item?.text || '';

        if (item?.extra) {
            for (const subitem of item.extra) {
                text += extractTextFromItem(subitem);
            }
        }

        return text;
    };

    const removeColorSymbols = (text) => text.replace(/§./g, '');
    const removeEmojisAndEmptyBrackets = (text) => {
        return text.replace(/[^\w\s:.,-/[\]]/g, '')
            .replace(/\[\]/g, ' ');
    };

    let lines = [];
    try {
        if (!scoreboard || !scoreboard["1"]) return lines;
        const items = scoreboard["1"].itemsMap;
        if (!items) return lines;
        const keys = Object.keys(items);

        for (let i = 0; i < keys.length; i++) {
            const item = items[keys[i]];
            let line = removeColorSymbols(extractTextFromItem(item?.displayName || '').trim());
            line = removeEmojisAndEmptyBrackets(line);
            lines.push(line);
        }
    } catch (error) {}

    return lines;
}

module.exports = { startBots };