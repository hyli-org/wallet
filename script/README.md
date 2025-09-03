# Hyli Wallet Script

This Node.js script allows you to register new wallet accounts using the Hyli wallet system. It implements the same registration logic as the `PasswordAuthProvider` from the main wallet application.

## Prerequisites

- Node.js 18+ (with ES modules support)
- Access to a Hyli node service
- Access to a Hyli indexer service
- A valid invite code

## Installation

1. Install dependencies:
```bash
npm install
```

2. Make the script executable:
```bash
chmod +x hyli-wallet.js
```

## Configuration

The script uses environment variables for configuration:

- `NODE_BASE_URL`: URL of the Hyli node service (default: `http://localhost:4321`)
- `INDEXER_BASE_URL`: URL of the Hyli indexer service (default: `http://localhost:8082`)

## Usage

### Basic Registration

```bash
node hyli-wallet.js <username> <password> <inviteCode>
```

### With Custom Configuration

```bash
NODE_BASE_URL=http://your-node-url:4321 \
INDEXER_BASE_URL=http://your-indexer-url:8082 \
node hyli-wallet.js myuser mypassword123 INVITE123
```

### With Custom Salt

```bash
node hyli-wallet.js myuser mypassword123 INVITE123 mysalt123
```

### With Session Key Enabled

```bash
node hyli-wallet.js myuser mypassword123 INVITE123 mysalt123 true
```

## Arguments

1. **username** (required): The username for the account
2. **password** (required): The password (must be at least 8 characters)
3. **inviteCode** (required): The invite code to use
4. **salt** (optional): Custom salt (defaults to random string)
5. **enableSessionKey** (optional): Set to 'true' to enable session key (default: false)

## Example

```bash
# Basic registration
node hyli-wallet.js alice mysecretpassword INVITE123

# With custom configuration and session key
NODE_BASE_URL=http://localhost:8080 \
INDEXER_BASE_URL=http://localhost:8081 \
node hyli-wallet.js bob mypassword123 INVITE456 bobssalt true
```

## What the Script Does

1. **Validation**: Checks if the account already exists and validates the password
2. **Invite Code**: Claims the provided invite code
3. **Blob Creation**: Creates the necessary blobs for registration
4. **Contract Registration**: Ensures the wallet contract is registered
5. **Transaction Submission**: Sends blob and proof transactions
6. **Session Key** (optional): Generates and registers a session key if requested

## Output

The script provides detailed logging of each step and outputs:

- Success/failure status
- Transaction hashes
- Wallet information (including session key if enabled)

## Error Handling

The script includes comprehensive error handling for:
- Invalid credentials
- Network issues
- Service unavailability
- Invalid invite codes
- Account already exists

## Troubleshooting

### Common Issues

1. **Connection refused**: Check that your node and indexer services are running
2. **Invalid invite code**: Ensure the invite code is valid and not already used
3. **Password too short**: Password must be at least 8 characters
4. **Account exists**: The username is already taken

### Debug Mode

For more detailed logging, you can modify the script to add console.log statements or use Node.js debugging:

```bash
node --inspect hyli-wallet.js myuser mypassword123 INVITE123
```

## Security Notes

- The script handles sensitive information (passwords, private keys)
- Session keys are generated locally and should be kept secure
- Consider using environment variables for sensitive configuration
- The script does not store credentials permanently

## Dependencies

- `hyli`: Core Hyli blockchain library
- `hyli-check-secret`: Secret checking and proof generation
- `js-sha3`: SHA3 hashing
- `elliptic`: Elliptic curve cryptography
- `crypto-js`: Cryptographic utilities
- `buffer`: Buffer polyfill for Node.js

## License

MIT License
