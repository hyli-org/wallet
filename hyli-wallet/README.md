# Hyle Wallet

A reusable React wallet component for blockchain applications, designed to provide seamless wallet management functionality.

## Features

- 🔐 Multiple authentication providers (Password, Google, Github, etc.)
- 🔑 Session key management
- 💰 Transaction handling
- 📡 WebSocket integration for real-time updates
- 🎨 Customizable UI
- 🔄 State management via React Context

## Installation

```bash
npm install hyli-wallet
# or
yarn add hyli-wallet
```

Required peer dependencies:
```json
{
  "hyle-check-secret": "^0.3.2",
  "react": "^19.1.0",
  "react-dom": "^19.1.0",
  "react-router-dom": "^7.5.0"
}
```

## Basic Usage

1. First, wrap your application with the `WalletProvider`:

```tsx
import { WalletProvider } from 'hyli-wallet';

function App() {
  return (
    <WalletProvider config={{
      nodeBaseUrl: 'NODE_BASE_URL',
      walletServerBaseUrl: 'WALLET_SERVER_URL',
      applicationWsUrl: 'WEBSOCKET_URL'
    }}>
      <YourApp />
    </WalletProvider>
  );
}
```

2. Use the wallet component:

```tsx
import { HyleWallet } from 'hyli-wallet';

function YourComponent() {
  return (
    <HyleWallet 
      providers={['password', 'google', 'github']} // Optional: specify auth providers
    />
  );
}
```

## Using the Wallet Hook

The `useWallet` hook provides access to wallet functionality:

```tsx
import { useWallet } from 'hyli-wallet';

function WalletFeatures() {
  const { 
    wallet,           // Current wallet state
    isLoading,
    error,
    login,           // Login function
    registerAccount,  // Create new account
    logout,          // Logout function
    registerSessionKey,  // Create new session key
    removeSessionKey,    // Remove existing session key
  } = useWallet();

  return (
    <div>
      {wallet ? (
        <div>
          <p>Welcome, {wallet.username}</p>
          <p>Balance: {balance} HYLLAR</p>
          <button onClick={logout}>Logout</button>
        </div>
      ) : (
        <p>Please connect your wallet</p>
      )}
    </div>
  );
}
```

## Session Key Management

> **Note:** 
> You can find a complete and exhaustive implementation in [`here`](../front/src/components/wallet/SessionKeys.tsx).

### Creating a Session Key

Session keys allow for delegated transaction signing. Here's how to create one:

```typescript
import { useWallet } from 'hyle-wallet';

const { wallet, registerSessionKey } = useWallet();

// Create a session key that expires in 7 days
const expiration = Date.now() + (7 * 24 * 60 * 60 * 1000);

const { sessionKey } = await registerSessionKey(
  'your_password',
  expiration,
  ['hyllar'] // contracts whitelist
  (txHash: string, type: string) => {
     if (type === 'blob') {
       console.log('Verifying identity...');
       console.log("transaction hash: ", txHash);
     } else if (type === 'proof') {
       console.log('Proof sent, waiting for confirmation...');
       console.log("transaction hash: ", txHash);
     }
   }
);

// The sessionKey object contains:
console.log(sessionKey.publicKey);  // The public key to identify the session
console.log(sessionKey.privateKey); // The private key to sign transactions
// Note that this session key will also be stored in the wallet object
```

Session keys allow for automated transaction signing:

### Using a Session Key

Once you have a session key, you can use it to send transactions:

```typescript
import { useWallet } from 'hyle-wallet';
import { nodeService } from 'your-services';

const { wallet, createIdentityBlobs } = useWallet();

// Create identity blobs using the latest created session key, stored in  `wallet` object
const [blob0, blob1] = createIdentityBlobs();

// Create and send the transaction
const blobTx = {
  identity: wallet.address,
  blobs: [blob0, blob1],
};
// blob0 is the secp256k1 blob containing the signature done with the wallet's session keu
// blob1 is the hyli-wallet contract that verifies that the session key is valid

const txHash = await nodeService.client.sendBlobTx(blobTx);
console.log('Transaction sent:', txHash);
```

### Removing a Session Key

When a session key is no longer needed, you can remove it:

```typescript
import { useWallet } from 'hyle-wallet';

const { removeSessionKey } = useWallet();

// Remove the session key using the wallet password
await removeSessionKey(
  'your_password',
  'session_key_public_key'
);
```

## WebSocket Integration

Real-time updates for transactions and wallet events:

```tsx
function TransactionMonitor() {
  useWebSocketConnection(wallet?.address, event => {
    if (event.tx.status === 'Success') {
      // Handle successful transaction
      fetchBalance();
    }
  });
}
```

## Customizing the UI

You can customize the connect button by providing a render prop:

```tsx
<HyleWallet 
  button={({ onClick }) => (
    <button 
      className="custom-button"
      onClick={onClick}
    >
      Connect to Wallet
    </button>
  )}
/>
```

## Web Component Usage

The library also provides a web component for non-React applications:

```html
<script type="module" src="path/to/hyli-wallet/dist/hyli-wallet.es.js"></script>
<hyli-wallet providers="password,google"></hyli-wallet>
```

## Contributing

We welcome contributions! Please see our contributing guidelines for more details.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
