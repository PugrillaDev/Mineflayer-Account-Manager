# Mineflayer-Account-Manager

The **Mineflayer-Account-Manager** allows users to manage multiple types of Microsoft accounts and use them with the Mineflayer bot framework. The manager also supports using proxies and handling different account types.

## Features
- **Proxy Management**: Validate, delete, and retest proxies.
- **Account Management**: Load and manage Microsoft and Cookie-based accounts.
- **Bot API**: Starts a bot API for Mineflayer bots.
  
## Setup Instructions

### 1. Install Node.js and Dependencies

Make sure you have [Node.js](https://nodejs.org) installed on your system. Once Node.js is installed, run the following command in your project directory to install the necessary dependencies:

```bash
npm install
```

### 2. Creating the Accounts Folder

You need to create an `accounts` folder inside the `lib` directory to store the account files. 

To do this, follow these steps:

1. Navigate to your project directory.
2. Create the necessary folders:
   
```bash
mkdir -p lib/accounts
```

3. Place your account files (either Microsoft `.json` files or Cookie `.txt` files) in the `lib/accounts` directory.

### 3. Preparing Proxies

In order to use proxies, create a `proxies.txt` file in the root of your project directory. The format for each line in `proxies.txt` should be:

```
<proxy_host>:<proxy_port>:<username>:<password>
```

Make sure each proxy is listed on a new line.

### 4. Running the Application

Once the accounts and proxies are set up, you can start the application with the following command:

```bash
node index.js
```

### 5. Validating Proxies

Upon startup, the application will automatically validate the proxies listed in `proxies.txt`. If invalid proxies are found, you will be prompted to:

- **Delete non-working proxies**
- **Retest all proxies**

Follow the prompts to handle the proxy validation.

### 6. Selecting Accounts

The application will ask you to select the type of accounts to load (Microsoft or Cookie) and how many accounts you wish to use. If no accounts are found, you'll be prompted to add more.

- **For Microsoft Accounts**: You can randomly generate accounts or add existing ones.
- **For Cookie Accounts**: The program will attempt to load any valid `.txt` files found in the `lib/accounts` directory.

### 7. Start Bots and API

After the account selection, the application will start the Mineflayer bots and the API for managing them.

### Additional Notes

- **Proxies**: The proxy validation process will give you options to handle invalid proxies and only work with valid ones.
- **Accounts**: You can load multiple accounts, and the program allows for adding more as you go.
- **Bot API**: The API allows you to manage and monitor bots once they are running.

## License
This project is licensed under the MIT License.
