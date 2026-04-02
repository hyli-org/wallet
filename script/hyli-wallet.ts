#!/usr/bin/env node

/**
 * hyli-wallet-cli — Wallet management for the Hyli blockchain.
 *
 * Ported from mpp-hyli's proven account/wallet code.
 * Uses HyliApp auth (secp256k1) for registration — no password, no Noir proof.
 * Uses check_secret (Noir ZK proof) only for funding from hyli@wallet faucet.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { NodeApiHttpClient, blob_builder } from "hyli";
import type { BlobTransaction, Blob } from "hyli";
import elliptic from "elliptic";
import { BorshSchema, borshSerialize } from "borsher";

const EC = elliptic.ec;
const ec = new EC("secp256k1");

// ── Config ──

const CONFIG = {
    NODE_URL: process.env.NODE_BASE_URL || "http://localhost:4321",
    INDEXER_URL: process.env.INDEXER_BASE_URL || "http://localhost:4322",
    WALLET_SERVER_URL: process.env.WALLET_API_BASE_URL || "http://localhost:4000",
    WALLET_CONTRACT: "wallet",
    DEFAULT_CURRENCY: "oranj",
    DEFAULT_INVITE_CODE: "vip",
};

// ── Types ──

interface SessionKey {
    publicKey: string;
    privateKey: string;
    expiration: number;
    whitelist?: string[];
}

interface Wallet {
    username: string;
    address: string;
    salt: string;
    sessionKey?: SessionKey;
}

interface Secp256k1Blob {
    identity: string;
    data: number[];
    public_key: number[];
    signature: number[];
}

// ── Crypto ──

function sha256(data: Uint8Array): Uint8Array {
    return new Uint8Array(createHash("sha256").update(data).digest());
}

function sha3_256(data: Uint8Array): Uint8Array {
    return new Uint8Array(createHash("sha3-256").update(data).digest());
}

function hexToBytes(hex: string): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substring(i, i + 2), 16));
    }
    return bytes;
}

function bytesToHex(data: Uint8Array | number[]): string {
    return Array.from(data)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function generateSessionKey(expiration: number, whitelist?: string[]): SessionKey {
    const keyPair = ec.genKeyPair();
    return {
        publicKey: keyPair.getPublic(true, "hex"),
        privateKey: keyPair.getPrivate("hex"),
        expiration,
        whitelist,
    };
}

function signMessageRaw(message: string, privateKey: string): [number[], number[]] {
    const hashBytes = sha256(new TextEncoder().encode(message));
    const keyPair = ec.keyFromPrivate(privateKey);
    const sig = keyPair.sign(bytesToHex(hashBytes));

    const n = ec.curve.n!;
    if (sig.s.gt(n.shrn(1))) {
        sig.s = n.sub(sig.s);
    }

    return [
        Array.from(hashBytes),
        [...sig.r.toArray("be", 32), ...sig.s.toArray("be", 32)],
    ];
}

/** Sign a message with a wallet's session key. */
function sign(wallet: Wallet, message: string, hash: "sha256" | "sha3-256" = "sha256"): string {
    if (!wallet.sessionKey) throw new Error("No session key found.");
    const hashFn = hash === "sha3-256" ? sha3_256 : sha256;
    const hashBytes = hashFn(new TextEncoder().encode(message));
    const keyPair = ec.keyFromPrivate(wallet.sessionKey.privateKey);
    const sig = keyPair.sign(bytesToHex(hashBytes));

    const n = ec.curve.n!;
    if (sig.s.gt(n.shrn(1))) {
        sig.s = n.sub(sig.s);
    }

    return bytesToHex(new Uint8Array([
        ...sig.r.toArray("be", 32),
        ...sig.s.toArray("be", 32),
    ]));
}

function getPublicKey(wallet: Wallet, format: "compressed" | "uncompressed" = "compressed"): string {
    if (!wallet.sessionKey) throw new Error("No session key found.");
    const keyPair = ec.keyFromPrivate(wallet.sessionKey.privateKey);
    return keyPair.getPublic(format === "compressed", "hex");
}

// ── Borsh Schemas ──

const secp256k1BlobSchema = BorshSchema.Struct({
    identity: BorshSchema.String,
    data: BorshSchema.Array(BorshSchema.u8, 32),
    public_key: BorshSchema.Array(BorshSchema.u8, 33),
    signature: BorshSchema.Array(BorshSchema.u8, 64),
});

const walletActionSchema = BorshSchema.Enum({
    RegisterIdentity: BorshSchema.Struct({
        account: BorshSchema.String,
        nonce: BorshSchema.u128,
        salt: BorshSchema.String,
        auth_method: BorshSchema.Enum({
            Password: BorshSchema.Struct({ hash: BorshSchema.String }),
            Jwt: BorshSchema.Struct({ hash: BorshSchema.Array(BorshSchema.u8, 32) }),
            Ethereum: BorshSchema.Struct({ address: BorshSchema.String }),
            Uninitialized: BorshSchema.Unit,
            HyliApp: BorshSchema.Struct({ address: BorshSchema.String }),
        }),
        invite_code: BorshSchema.String,
    }),
    VerifyIdentity: BorshSchema.Struct({
        account: BorshSchema.String,
        nonce: BorshSchema.u128,
    }),
    AddSessionKey: BorshSchema.Struct({
        account: BorshSchema.String,
        key: BorshSchema.String,
        expiration_date: BorshSchema.u128,
        whitelist: BorshSchema.Option(BorshSchema.Vec(BorshSchema.String)),
        lane_id: BorshSchema.Option(BorshSchema.String),
        nonce: BorshSchema.u128,
    }),
    RemoveSessionKey: BorshSchema.Struct({
        account: BorshSchema.String,
        key: BorshSchema.String,
        nonce: BorshSchema.u128,
    }),
    UseSessionKey: BorshSchema.Struct({
        account: BorshSchema.String,
        nonce: BorshSchema.u128,
    }),
});

function serializeSecp256k1Blob(blob: Secp256k1Blob): number[] {
    return Array.from(borshSerialize(secp256k1BlobSchema, blob));
}

function serializeWalletAction(action: object): number[] {
    return Array.from(borshSerialize(walletActionSchema, action));
}

// ── Blob Builders ──

function getSignedBlobForRegistration(
    identity: string,
    nonce: number,
    privateKey: string,
): { blob: Blob; publicKey: string } {
    const message = `${identity}:${nonce}:hyliapp`;
    const [hashBytes, signatureBytes] = signMessageRaw(message, privateKey);
    const keyPair = ec.keyFromPrivate(privateKey);
    const publicKey = keyPair.getPublic(true, "hex");

    return {
        blob: {
            contract_name: "secp256k1",
            data: serializeSecp256k1Blob({
                identity,
                data: hashBytes,
                public_key: hexToBytes(publicKey),
                signature: signatureBytes,
            }),
        },
        publicKey,
    };
}

function registerBlob(
    account: string, nonce: number, salt: string, authMethod: object, inviteCode: string,
): Blob {
    return {
        contract_name: CONFIG.WALLET_CONTRACT,
        data: serializeWalletAction({
            RegisterIdentity: { account, nonce, salt, auth_method: authMethod, invite_code: inviteCode },
        }),
    };
}

function addSessionKeyBlob(
    account: string, key: string, expirationDate: number, nonce: number, whitelist?: string[],
): Blob {
    return {
        contract_name: CONFIG.WALLET_CONTRACT,
        data: serializeWalletAction({
            AddSessionKey: { account, key, expiration_date: expirationDate, whitelist: whitelist ?? null, lane_id: null, nonce },
        }),
    };
}

function verifyIdentityBlob(account: string, nonce: number): Blob {
    return {
        contract_name: CONFIG.WALLET_CONTRACT,
        data: serializeWalletAction({ VerifyIdentity: { account, nonce } }),
    };
}

function createIdentityBlobs(wallet: Wallet): [Blob, Blob] {
    if (!wallet.sessionKey) throw new Error("No session key found.");
    if (wallet.sessionKey.expiration < Date.now()) throw new Error("Session key expired.");

    const nonce = Date.now();
    const [hashBytes, signatureBytes] = signMessageRaw(nonce.toString(), wallet.sessionKey.privateKey);
    const keyPair = ec.keyFromPrivate(wallet.sessionKey.privateKey);

    const blob0: Blob = {
        contract_name: "secp256k1",
        data: serializeSecp256k1Blob({
            identity: wallet.address,
            data: hashBytes,
            public_key: hexToBytes(keyPair.getPublic(true, "hex")),
            signature: signatureBytes,
        }),
    };

    const blob1: Blob = {
        contract_name: CONFIG.WALLET_CONTRACT,
        data: serializeWalletAction({ UseSessionKey: { account: wallet.username, nonce } }),
    };

    return [blob0, blob1];
}

// ── Wallet Storage ──

const CONFIG_DIR = join(homedir(), ".hyli");
const WALLETS_DIR = join(CONFIG_DIR, "wallets");
const DEFAULT_FILE = join(CONFIG_DIR, "default");

function ensureWalletsDir(): void {
    if (!existsSync(WALLETS_DIR)) mkdirSync(WALLETS_DIR, { recursive: true });
}

function saveWallet(wallet: Wallet, name?: string): void {
    const walletName = name ?? wallet.username;
    ensureWalletsDir();
    writeFileSync(join(WALLETS_DIR, `${walletName}.json`), JSON.stringify(wallet, null, 2));
    if (getDefaultWalletName() === null) setDefaultWallet(walletName);
}

function loadWallet(name?: string): Wallet | null {
    const walletName = name ?? getDefaultWalletName();
    if (!walletName) return null;
    const filePath = join(WALLETS_DIR, `${walletName}.json`);
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf-8")) as Wallet;
}

function listWallets(): string[] {
    if (!existsSync(WALLETS_DIR)) return [];
    return readdirSync(WALLETS_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
}

function setDefaultWallet(name: string): void {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(DEFAULT_FILE, name);
}

function getDefaultWalletName(): string | null {
    const fromEnv = process.env.HYLI_WALLET?.trim();
    if (fromEnv) return fromEnv;
    if (!existsSync(DEFAULT_FILE)) return null;
    const name = readFileSync(DEFAULT_FILE, "utf-8").trim();
    return name || null;
}

function walletPath(name?: string): string {
    const walletName = name ?? getDefaultWalletName();
    if (walletName) return join(WALLETS_DIR, `${walletName}.json`);
    return join(WALLETS_DIR, "default.json");
}

// ── Ensure check_secret ──

let checkSecretDone = false;
async function ensureCheckSecretRegistered(): Promise<void> {
    if (checkSecretDone) return;
    try {
        const resp = await fetch(`${CONFIG.INDEXER_URL}/v1/indexer/contracts`);
        if (resp.ok) {
            const contracts = (await resp.json()) as Array<{ contract_name: string }>;
            if (contracts.some((c) => c.contract_name === "check_secret")) {
                checkSecretDone = true;
                return;
            }
        }
    } catch { /* proceed */ }

    console.log("  Registering check_secret contract...");
    const { check_secret } = await import("hyli-noir");
    const node = new NodeApiHttpClient(CONFIG.NODE_URL);
    try {
        await check_secret.register_contract(node);
    } catch {
        console.log("  check_secret registration skipped (may already exist).");
    }
    checkSecretDone = true;
}

// ── Commands ──

/** Register account using HyliApp auth (no password, no proof). Copied from mpp-hyli. */
async function registerAccount(username: string, inviteCode: string, currency: string = CONFIG.DEFAULT_CURRENCY): Promise<Wallet> {
    const walletContract = CONFIG.WALLET_CONTRACT;
    const identity = `${username}@${walletContract}`;
    const nodeClient = new NodeApiHttpClient(CONFIG.NODE_URL);

    console.log(`Creating wallet for ${identity}...`);

    // 1. Generate session key (7-day expiry)
    const expiration = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const sessionKey = generateSessionKey(expiration, [currency, walletContract]);

    // 2. Consume invite code
    console.log("  Consuming invite code...");
    const inviteResp = await fetch(`${CONFIG.WALLET_SERVER_URL}/api/consume_invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: inviteCode, wallet: username }),
    });
    if (!inviteResp.ok) throw new Error(`Failed to consume invite code: ${await inviteResp.text()}`);
    const inviteBlob: Blob = await inviteResp.json();

    // 3. Register identity with HyliApp auth
    console.log("  Registering identity...");
    const nonce = Date.now();
    const salt = Math.random().toString(36).substring(2, 10);

    const { blob: sigBlob, publicKey } = getSignedBlobForRegistration(identity, nonce, sessionKey.privateKey);
    const address = publicKey.slice(0, 40);

    const regBlob = registerBlob(username, nonce, salt, { HyliApp: { address } }, inviteCode);

    const regBlobTx: BlobTransaction = { identity, blobs: [inviteBlob, sigBlob, regBlob] };
    const regTxHash = await nodeClient.sendBlobTx(regBlobTx);
    console.log(`  Registration tx: ${regTxHash}`);

    // 4. Add session key (separate tx)
    console.log("  Adding session key...");
    const skBlob = addSessionKeyBlob(username, sessionKey.publicKey, expiration, nonce + 1, [currency, walletContract]);
    const { blob: skSigBlob } = getSignedBlobForRegistration(identity, nonce + 1, sessionKey.privateKey);

    const skBlobTx: BlobTransaction = { identity, blobs: [skBlob, skSigBlob] };
    const skTxHash = await nodeClient.sendBlobTx(skBlobTx);
    console.log(`  Session key tx: ${skTxHash}`);

    // 5. Save wallet
    const wallet: Wallet = { username, address: identity, salt, sessionKey };
    saveWallet(wallet, username);
    console.log(`  Saved to: ${walletPath(username)}`);

    return wallet;
}

/** Fund wallet from hyli@wallet faucet. Uses check_secret Noir proof. Copied from mpp-hyli. */
async function fundAccount(walletName?: string, amount: number = 1000, currency: string = CONFIG.DEFAULT_CURRENCY): Promise<void> {
    const wallet = loadWallet(walletName);
    if (!wallet) throw new Error(`No wallet found. Run \`hyli-wallet register\` first.`);

    const fromAccount = "hyli";
    const fromIdentity = `${fromAccount}@wallet`;
    const fromSaltedPassword = "hylisecure:hyli-random-salt";
    const node = new NodeApiHttpClient(CONFIG.NODE_URL);

    console.log(`Funding ${wallet.address} with ${amount} ${currency} from ${fromIdentity}...`);
    await ensureCheckSecretRegistered();

    const { check_secret } = await import("hyli-noir");

    console.log("  Building blobs...");
    const secretBlob = await check_secret.build_blob(fromIdentity, fromSaltedPassword);
    const nonce = Date.now();
    const verifyBlob = verifyIdentityBlob(fromAccount, nonce);
    const transferBlob = blob_builder.smt_token.transfer(fromIdentity, wallet.address, currency, BigInt(amount), null);

    const blobTx: BlobTransaction = { identity: fromIdentity, blobs: [secretBlob, verifyBlob, transferBlob] };

    console.log("  Submitting blob tx...");
    const txHash = await node.sendBlobTx(blobTx);
    console.log(`  Blob tx: ${txHash}`);

    console.log("  Generating ZK proof (this may take 30-60s)...");
    const proofTx = await check_secret.build_proof_transaction(fromIdentity, fromSaltedPassword, txHash, 0, blobTx.blobs.length);
    console.log("  Submitting proof...");
    const proofHash = await node.sendProofTx(proofTx);
    console.log(`  Proof tx: ${proofHash}`);
    console.log(`  Funded: ${amount} ${currency}`);
}

/** Transfer using session key (fast, no proof). */
async function transferWithSessionKey(wallet: Wallet, amount: string, token: string, destination: string): Promise<void> {
    const node = new NodeApiHttpClient(CONFIG.NODE_URL);
    console.log(`  Transferring ${amount} ${token} from ${wallet.address} to ${destination}...`);

    const [signatureBlob, sessionKeyBlob] = createIdentityBlobs(wallet);
    const transferBlob = blob_builder.smt_token.transfer(wallet.address, destination, token, BigInt(amount), null);

    const blobTx: BlobTransaction = { identity: wallet.address, blobs: [signatureBlob, sessionKeyBlob, transferBlob] };
    const txHash = await node.sendBlobTx(blobTx);
    console.log(`  Transaction: ${txHash}`);
}

async function showInfo(walletName?: string): Promise<void> {
    const wallet = loadWallet(walletName);
    if (!wallet) { console.log("No wallet found. Run `hyli-wallet register` first."); return; }

    console.log(`Identity: ${wallet.address}`);
    console.log(`Wallet file: ${walletPath(walletName)}`);

    try {
        const resp = await fetch(`${CONFIG.INDEXER_URL}/v1/indexer/contract/${CONFIG.DEFAULT_CURRENCY}/state`);
        if (resp.ok) {
            const state = await resp.json() as Record<string, { balance?: number }>;
            const entry = state[wallet.address];
            console.log(`Balance: ${entry?.balance ?? 0} ${CONFIG.DEFAULT_CURRENCY}`);
        } else {
            console.log(`Balance: unknown (indexer returned ${resp.status})`);
        }
    } catch {
        console.log("Balance: unknown (could not reach indexer)");
    }

    if (wallet.sessionKey) {
        const expiry = new Date(wallet.sessionKey.expiration);
        const isExpired = expiry.getTime() < Date.now();
        console.log(`Session key: ${isExpired ? "EXPIRED" : "active"} (expires ${expiry.toISOString()})`);
        if (wallet.sessionKey.whitelist?.length) console.log(`  Whitelisted: ${wallet.sessionKey.whitelist.join(", ")}`);
    } else {
        console.log("Session key: none");
    }
}

// ── CLI ──

function showUsage(): void {
    console.log(`Usage: hyli-wallet <command> [options]

Account commands:
  register <username> <inviteCode> [currency]    Create account with session key
  fund [amount] [currency] [walletName]           Fund wallet from hyli@wallet faucet
  info [walletName]                               Show wallet info and balance
  list                                            List all wallets
  default <name>                                  Set the default wallet

Transfer:
  send <amount> <token> <destination> [wallet]    Transfer using session key (fast)

Signing:
  sign <message> [walletName] [--sha3]            Sign a message with session key
  pubkey [walletName] [--uncompressed]             Show public key

Environment variables:
  NODE_BASE_URL        Node URL (default: http://localhost:4321)
  INDEXER_BASE_URL     Indexer URL (default: http://localhost:4322)
  WALLET_API_BASE_URL  Wallet API URL (default: http://localhost:4000)
  HYLI_WALLET          Default wallet name override

Wallets are stored at ~/.hyli/wallets/<name>.json`);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.length < 1) { showUsage(); process.exit(1); }

    const command = args[0];

    try {
        switch (command) {
            case "register": {
                if (args.length < 3) { console.log("Usage: hyli-wallet register <username> <inviteCode> [currency]"); process.exit(1); }
                const [, username, inviteCode, currency] = args;
                await registerAccount(username, inviteCode, currency);
                console.log("Done.");
                break;
            }
            case "fund": {
                const [, amount = "1000", currency = CONFIG.DEFAULT_CURRENCY, walletName] = args;
                await fundAccount(walletName, parseInt(amount), currency);
                console.log("Done.");
                break;
            }
            case "info": {
                await showInfo(args[1]);
                break;
            }
            case "list": {
                const wallets = listWallets();
                if (wallets.length === 0) { console.log("No wallets found."); break; }
                const def = getDefaultWalletName();
                for (const name of wallets) console.log(`  ${name}${name === def ? " (default)" : ""}`);
                break;
            }
            case "default": {
                if (args.length < 2) { console.log("Usage: hyli-wallet default <name>"); process.exit(1); }
                const wallets = listWallets();
                if (!wallets.includes(args[1])) { console.error(`Wallet "${args[1]}" not found.`); process.exit(1); }
                setDefaultWallet(args[1]);
                console.log(`Default wallet set to: ${args[1]}`);
                break;
            }
            case "send": {
                if (args.length < 4) { console.log("Usage: hyli-wallet send <amount> <token> <destination> [walletName]"); process.exit(1); }
                const [, amount, token, destination, walletName] = args;
                const wallet = loadWallet(walletName);
                if (!wallet?.sessionKey) { console.error("No wallet with session key found."); process.exit(1); }
                await transferWithSessionKey(wallet, amount, token, destination);
                console.log("Done.");
                break;
            }
            case "sign": {
                if (args.length < 2) { console.log("Usage: hyli-wallet sign <message> [walletName] [--sha3]"); process.exit(1); }
                const useSha3 = args.includes("--sha3");
                const walletName = args.find((a, i) => i > 1 && !a.startsWith("--"));
                const wallet = loadWallet(walletName);
                if (!wallet) { console.error("No wallet found."); process.exit(1); }
                console.log(sign(wallet, args[1], useSha3 ? "sha3-256" : "sha256"));
                break;
            }
            case "pubkey": {
                const walletName = args.find((a, i) => i > 0 && !a.startsWith("--"));
                const wallet = loadWallet(walletName);
                if (!wallet) { console.error("No wallet found."); process.exit(1); }
                console.log(getPublicKey(wallet, args.includes("--uncompressed") ? "uncompressed" : "compressed"));
                break;
            }
            default:
                console.log(`Unknown command: ${command}`);
                showUsage();
                process.exit(1);
        }
    } catch (error: any) {
        console.error("Error:", error.message);
        process.exit(1);
    }

    setTimeout(() => process.exit(0), 100);
}

if (import.meta.url.endsWith("hyli-wallet.js") || process.argv[1].includes("hyli-wallet")) {
    main().catch((error) => { console.error("Error:", error.message); process.exit(1); });
}

export {
    registerAccount, fundAccount, transferWithSessionKey,
    sign, getPublicKey, createIdentityBlobs, generateSessionKey,
    saveWallet, loadWallet, listWallets, setDefaultWallet, getDefaultWalletName,
};
