process.emitWarning = () => {};

const readline = require('readline');
const ProxyManager = require('./src/utils/ProxyManager');
const AccountManager = require('./src/utils/AccountManager');
const { startBots } = require('./src/functions/mineflayer');
const { startAPI } = require('./src/utils/BotAPI');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function validateProxies() {
    const chalk = (await import('chalk')).default;
    console.log(chalk.cyan('Validating proxies...'));

    const proxies = ProxyManager.loadProxies();

    if (proxies.length === 0) {
        console.log(chalk.red('No proxies found in proxies.txt.'));
        process.exit(1);
    }

    const validationPromises = proxies.map(async (proxy) => {
        const isValid = await ProxyManager.validateProxy(proxy);
        return { proxy, isValid };
    });

    const results = await Promise.all(validationPromises);

    const workingProxies = results.filter(result => result.isValid).map(result => result.proxy);
    const nonWorkingProxies = results.filter(result => !result.isValid).map(result => result.proxy);

    console.log(chalk.green(`${workingProxies.length} proxies are working`) + chalk.red(`, ${nonWorkingProxies.length} are not.`));

    return { workingProxies, nonWorkingProxies };
}

async function handleProxyValidation() {
    const chalk = (await import('chalk')).default;
    const { workingProxies, nonWorkingProxies } = await validateProxies();

    if (nonWorkingProxies.length > 0) {
        console.log(chalk.yellow('Options:'));
        console.log(chalk.yellow('1. Delete non-working proxies'));
        console.log(chalk.yellow('2. Retest all proxies'));
        
        const choice = await question(chalk.blue('Select an option (1 or 2): '));

        if (choice === '1') {
            nonWorkingProxies.forEach(proxy => {
                ProxyManager.removeProxy(proxy);
            });
            console.log(chalk.red('Deleted non-working proxies.'));
        } else if (choice === '2') {
            await handleProxyValidation();
        } else {
            console.log(chalk.red('Invalid choice. Please try again.'));
            await handleProxyValidation();
        }
    }

    if (workingProxies.length === 0) {
        console.log(chalk.red('No working proxies available. Please add valid proxies to proxies.txt and restart the application.'));
        process.exit(1);
    }
}

async function selectAccounts() {
    const chalk = (await import('chalk')).default;
    console.log(chalk.cyan('Select account type to load:'));
    console.log(chalk.cyan('1. Microsoft'));
    console.log(chalk.cyan('2. Cookie'));

    const accountTypeChoice = await question(chalk.blue('Enter your choice (1 or 2): '));
    const accountType = accountTypeChoice === '1' ? 'microsoft' : 'cookie';

    let accountsToLoad = AccountManager.loadAccountsByType(accountType);

    if (accountsToLoad.length > 0) {
        console.log(chalk.green(`Found ${accountsToLoad.length} ${accountType} accounts.`));

        const accountCount = await question(chalk.blue(`How many of the ${accountsToLoad.length} existing ${accountType} accounts do you want to use? `));
        const numAccountsToUse = Math.max(0, Math.min(accountsToLoad.length, parseInt(accountCount, 10)));

        accountsToLoad = accountsToLoad.slice(0, numAccountsToUse);
        console.log(chalk.green(`Loaded ${accountsToLoad.length} existing ${accountType} accounts.`));
    } else {
        console.log(chalk.red(`No ${accountType} accounts found in the accounts directory.`));
    }

    if (accountType === 'microsoft') {
        const additionalAccountCount = await question(chalk.blue(`How many additional Microsoft accounts do you want to add? `));
        const numAdditionalAccounts = Math.max(0, parseInt(additionalAccountCount, 10));

        if (numAdditionalAccounts > 0) {
            const newMicrosoftAccounts = Array.from({ length: numAdditionalAccounts }, () => 
                ({ file: `random-${Math.random().toString(36).substring(2, 9)}.json`, type: 'microsoft' })
            );

            accountsToLoad.push(...newMicrosoftAccounts);
            console.log(chalk.green(`Added ${numAdditionalAccounts} random Microsoft accounts.`));
        }
    }

    if (accountType !== "cookie") console.log(chalk.green(`Loaded a total of ${accountsToLoad.length} ${accountType} accounts.`));
    return accountsToLoad;
}

async function startup() {
    const chalk = (await import('chalk')).default;
    await handleProxyValidation();

    const accounts = await selectAccounts();
    
    while (true) {
        console.log(chalk.cyan('Options:'));
        console.log(chalk.cyan('1. Load more accounts'));
        console.log(chalk.cyan('2. Continue with current selection'));

        const choice = await question(chalk.blue('Select an option (1 or 2): '));

        if (choice === '1') {
            const additionalAccounts = await selectAccounts();
            accounts.push(...additionalAccounts);
        } else if (choice === '2') {
            break;
        } else {
            console.log(chalk.red('Invalid choice. Please try again.'));
        }
    }

    rl.close();

    startAPI();
    await startBots(accounts);
}

startup();