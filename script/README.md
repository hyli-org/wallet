# Hyli Wallet CLI

A standalone command-line tool for managing Hyli wallet accounts.

## 🚀 Quick Start

### Option 1: Install from NPM (Recommended)

```bash
# Install globally
npm install -g hyli-wallet-cli

# Use the command
hyli-wallet --help
```

### Option 2: Install from Source

```bash
# Clone just this package
git clone https://github.com/hyli-org/wallet.git
cd wallet/script

# Install dependencies
npm install

# Make it globally available
npm link

# Use the command
hyli-wallet --help
```

## 📖 Usage

```bash
hyli-wallet <command> [options]
```

### Commands

#### Register Account
```bash
hyli-wallet register <username> <password> <inviteCode> [salt] [enableSessionKey]
```

**Arguments:**
- **username** - The username for the account
- **password** - The password (must be at least 8 characters)
- **inviteCode** - The invite code to use
- **salt** - Optional salt (defaults to random string)
- **enableSessionKey** - Optional: 'true' to enable session key (default: false)

#### Transfer Funds
```bash
hyli-wallet transfer <username> <password> <amount> <token> <destination>
```

**Arguments:**
- **username** - The username of the sender account
- **password** - The password for the sender account
- **amount** - The amount to transfer (positive number)
- **token** - The token/currency to transfer (e.g., 'oranj')
- **destination** - The destination address or username

### Environment Variables

- `NODE_BASE_URL` - Node service URL (default: http://localhost:4321)
- `INDEXER_BASE_URL` - Indexer service URL (default: http://localhost:4322)
- `WALLET_API_BASE_URL` - Wallet API URL (default: http://localhost:4000)

### Examples

```bash
# Register a new account
hyli-wallet register myuser mypassword123 INVITE123

# Register with custom salt
hyli-wallet register myuser mypassword123 INVITE123 mysalt

# Register with session key enabled
hyli-wallet register myuser mypassword123 INVITE123 mysalt true

# Transfer funds
hyli-wallet transfer myuser mypassword123 100 oranj otheruser@wallet

# Transfer with custom service URLs
NODE_BASE_URL=http://localhost:4321 \
INDEXER_BASE_URL=http://localhost:4322 \
hyli-wallet transfer myuser mypassword123 50 oranj recipient@wallet
```

## 🔧 Configuration

The script automatically detects your environment and uses sensible defaults. You can override these by setting environment variables:

```bash
export NODE_BASE_URL="http://your-node:4321"
export INDEXER_BASE_URL="http://your-indexer:4322"
export WALLET_API_BASE_URL="http://your-wallet-api:4000"
```

## 📦 What's Included

This standalone package includes:

- ✅ Complete wallet registration functionality
- ✅ Fund transfer functionality
- ✅ Session key generation
- ✅ Invite code validation
- ✅ Blob transaction handling
- ✅ Proof transaction generation

## 🛠️ Development

### Prerequisites

- Node.js 16.0.0 or higher
- npm or yarn

### Local Development

```bash
# Clone the repository
git clone https://github.com/hyli/wallet.git
cd wallet/script

# Install dependencies
bun install

# Run the script
bun hyli-wallet.js register myuser mypassword123 INVITE123
bun hyli-wallet.js transfer myuser mypassword123 100 oranj otheruser@wallet
```

### Building for Distribution

```bash
# Publish to NPM (if you have access)
bun run pub
```

## 🐛 Troubleshooting

## 📄 License

MIT License

## 🤝 Contributing

Contributions are welcome! Please see the [contributing guide](https://github.com/hyli-org/hyli/blob/main/CONTRIBUTING.md) for details.

---

**Made with ❤️ by the Hyli Team**
