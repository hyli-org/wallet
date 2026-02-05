# Hyli App QR Code Connector - Remaining Work

## Overview

The frontend implementation is complete. The following backend components are needed to make the QR signing flow functional.

---

## 1. WebSocket Signing Server

**Purpose**: Route signing requests between web wallet and mobile Hyli App

**Location**: `server/src/` (new module)

### Message Protocol

**Web Wallet → Server:**
```json
{ "type": "RegisterSigningRequest", "requestId": "uuid", "message": "hex", "description": "text", "origin": "url" }
{ "type": "CancelSigningRequest", "requestId": "uuid" }
```

**Mobile App → Server:**
```json
{ "type": "SubmitSignature", "requestId": "uuid", "signature": "64-byte-hex", "publicKey": "32-byte-hex" }
```

**Server → Web Wallet:**
```json
{ "type": "SigningResponse", "requestId": "uuid", "signature": "hex", "publicKey": "hex" }
{ "type": "SigningError", "requestId": "uuid", "error": "message" }
{ "type": "SigningRequestAck", "requestId": "uuid" }
```

### Implementation Tasks

- [ ] Create new WebSocket endpoint `/signing`
- [ ] Track pending signing requests by `requestId`
- [ ] Route signatures from mobile app to correct web client
- [ ] Handle request timeouts (2 minutes)
- [ ] Clean up expired requests

---

## 2. Ed25519 Verification Contract

**Purpose**: Verify Ed25519 signatures on-chain (similar to existing `secp256k1` contract)

**Location**: `contracts/ed25519/` (new contract)

### Blob Structure
```rust
pub struct Ed25519Blob {
    pub identity: String,      // e.g., "alice@wallet"
    pub data: [u8; 32],        // message hash
    pub public_key: [u8; 32],  // Ed25519 public key
    pub signature: [u8; 64],   // Ed25519 signature
}
```

### Implementation Tasks

- [ ] Create new `ed25519` contract
- [ ] Implement Ed25519 signature verification
- [ ] Verify identity matches caller
- [ ] Deploy to testnet/mainnet

---

## 3. Wallet Contract Update

**Purpose**: Add `HyliApp` as a supported authentication method

**Location**: `contracts/wallet/src/lib.rs`

### Changes Required

```rust
pub enum AuthMethod {
    Password { hash: String },
    Jwt { hash: [u8; 32] },
    Ethereum { address: String },
    HyliApp { public_key: String },  // NEW: 32-byte hex Ed25519 pubkey
}
```

### Implementation Tasks

- [ ] Add `HyliApp` variant to `AuthMethod` enum
- [ ] Update serialization/deserialization
- [ ] Update registration logic to accept HyliApp auth
- [ ] Update login verification for HyliApp accounts

---

## 4. Indexer Update

**Purpose**: Return `HyliApp` auth method in account info queries

**Location**: `server/src/` (indexer module)

### AccountInfo Response
```typescript
interface AccountInfo {
    account: string;
    auth_method:
        | { Password: { hash: string } }
        | { Jwt: { hash: number[] } }
        | { Ethereum: { address: string } }
        | { HyliApp: { public_key: string } };  // NEW
    session_keys: BackendSessionKey[];
    nonce: number;
    salt: string;
}
```

### Implementation Tasks

- [ ] Update `AccountInfo` struct to include `HyliApp`
- [ ] Update indexer to parse and return `HyliApp` auth method

---

## 5. Mobile App Integration

**Purpose**: Hyli App needs to scan QR codes and submit signatures

### QR Code Data Format
```json
{
    "message": "hex-encoded-32-bytes",
    "description": "Login as 'alice'",
    "origin": "https://app.example.com",
    "requestId": "uuid-v4"
}
```

### Mobile App Flow
1. Scan QR code
2. Display description and origin to user for approval
3. Sign message with Ed25519 private key
4. Submit signature to WebSocket server:
   ```json
   { "type": "SubmitSignature", "requestId": "...", "signature": "...", "publicKey": "..." }
   ```

---

## Architecture Diagram

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Web Wallet    │         │  WebSocket       │         │   Hyli App      │
│   (Browser)     │         │  Server          │         │   (Mobile)      │
└────────┬────────┘         └────────┬─────────┘         └────────┬────────┘
         │                           │                            │
         │ RegisterSigningRequest    │                            │
         │──────────────────────────>│                            │
         │                           │                            │
         │  [Display QR Code]        │                            │
         │  ┌────────────────┐       │                            │
         │  │ message        │       │     [Scan QR]              │
         │  │ description    │<──────┼────────────────────────────│
         │  │ origin         │       │                            │
         │  │ requestId      │       │                            │
         │  └────────────────┘       │                            │
         │                           │                            │
         │                           │     SubmitSignature        │
         │                           │<───────────────────────────│
         │                           │                            │
         │     SigningResponse       │                            │
         │<──────────────────────────│                            │
         │                           │                            │
         │  [Create BlobTx]          │                            │
         │                           │                            │
         ▼                           │                            │
┌─────────────────┐                  │                            │
│  Hylé Network   │                  │                            │
│  - ed25519      │                  │                            │
│  - wallet       │                  │                            │
└─────────────────┘                  │                            │
```

---

## Priority Order

1. **WebSocket Signing Server** - Required for end-to-end flow
2. **Ed25519 Verification Contract** - Required for on-chain verification
3. **Wallet Contract Update** - Required for HyliApp registration
4. **Indexer Update** - Required for login flow
5. **Mobile App Integration** - Separate project

---

## Testing Checklist

- [ ] WebSocket server handles concurrent signing requests
- [ ] Ed25519 signatures verify correctly on-chain
- [ ] Registration creates account with HyliApp auth method
- [ ] Login verifies public key matches stored auth method
- [ ] Session key registration works after QR login
- [ ] Timeout handling works (request expires after 2 min)
- [ ] Error handling for invalid signatures
