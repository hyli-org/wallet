# Hylé App Scaffold

This repository provides a scaffold to build applications on Hylé. Currently, this scaffold supports Risc0 contracts only.

## Architecture

The application follows a client-server architecture where:
- The frontend application sends operation requests to the server
- The server handles transaction crafting, sending, and proving
- All operations are processed through the Hylé network

## Getting Started

To run the application, you'll need to start three components:

### 1. Hylé Node
In your Hylé repository:
```bash
RISC0_DEV_MODE=1 cargo run -- --pg
```

### 2. Server
In this repository:
```bash
RISC0_DEV_MODE=1 cargo run -p server
```

### 3. Frontend
In this repository:
```bash
cd front && bun run dev
```

## Development

### Building Contracts
When making changes to the contracts, their ELF are automatically rebuilt. 
If you want to have reproducible builds with docker, remove the feature "nonreproducible" 
from server's Cargo.toml and build the contracts using:
```bash
cargo build -p contracts --features build --features all
```

## Scripts

For wallet account registration and management, see the [`script/`](./script/) folder which contains:

- **Wallet Registration Script**: A standalone Node.js script for registering wallet accounts
- **Examples**: Usage examples and batch registration scripts
- **Configuration**: Environment-specific configuration templates

### Quick Script Usage

```bash
cd script
npm install
node hyli-wallet.js <username> <password> <inviteCode>
```

For detailed documentation, see [script/README.md](./script/README.md).
