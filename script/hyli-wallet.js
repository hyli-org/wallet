#!/usr/bin/env node

import { Buffer } from "buffer";
import { NodeApiHttpClient, IndexerApiHttpClient } from "hyli";
import { build_proof_transaction, build_blob as check_secret_blob, register_contract } from "hyli-check-secret";
import EC from "elliptic";
import pkg from "js-sha3";
import { register as registerBlob, addSessionKey as addSessionKeyBlob } from "hyli-wallet";
const { sha3_256 } = pkg;

// Configuration - update these values
const CONFIG = {
    NODE_BASE_URL: process.env.NODE_BASE_URL || "http://localhost:4321",
    INDEXER_BASE_URL: process.env.INDEXER_BASE_URL || "http://localhost:4322",
    WALLET_API_BASE_URL: process.env.WALLET_API_BASE_URL || "http://localhost:4000",
    WALLET_CONTRACT_NAME: "wallet"
};

// Utility functions
const encodeToHex = (data) => {
    return Array.from(data)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
};

async function hashBlob(blob) {
    const contractBytes = new TextEncoder().encode(blob.contract_name);
    const dataBytes = blob.data instanceof Uint8Array ? blob.data : new Uint8Array(blob.data);
    const input = new Uint8Array(contractBytes.length + dataBytes.length);
    input.set(contractBytes, 0);
    input.set(dataBytes, contractBytes.length);
    return encodeToHex(new Uint8Array(sha3_256.arrayBuffer(input)));
}

async function hashBlobTransaction(tx) {
    const identityBytes = new TextEncoder().encode(tx.identity);
    let input = new Uint8Array(identityBytes.length);
    input.set(identityBytes, 0);
    for (const blob of tx.blobs) {
        const blobHashBytes = new TextEncoder().encode(await hashBlob(blob));
        const newInput = new Uint8Array(input.length + blobHashBytes.length);
        newInput.set(input, 0);
        newInput.set(blobHashBytes, input.length);
        input = newInput;
    }
    return encodeToHex(new Uint8Array(sha3_256.arrayBuffer(input)));
}

// Session key generation
function generateSessionKey(expiration, whitelist = []) {
    const ec = new EC.ec("secp256k1");
    const keyPair = ec.genKeyPair();

    const privateKey = keyPair.getPrivate("hex");
    if (!privateKey) {
        throw new Error("Failed to generate private key");
    }

    const publicKey = keyPair.getPublic(true, "hex");
    if (!publicKey) {
        throw new Error("Failed to generate public key");
    }

    return {
        publicKey,
        privateKey,
        expiration,
        whitelist,
    };
}



// Main registration function
async function registerAccount(username, password, inviteCode, salt, enableSessionKey = false) {
    console.log(`Starting registration for username: ${username}`);
    
    try {
        // Initialize services
        const nodeService = new NodeApiHttpClient(CONFIG.NODE_BASE_URL);
        const indexerService = new IndexerApiHttpClient(CONFIG.INDEXER_BASE_URL);
        
        // Check if account already exists
        try {
            const accountInfo = await indexerService.get(`v1/indexer/contract/${CONFIG.WALLET_CONTRACT_NAME}/account/${username}`);
            if (accountInfo) {
                throw new Error(`Account with username "${username}" already exists.`);
            }
        } catch (error) {
            // If error, assume account does not exist and continue
            console.log("Account does not exist, proceeding with registration...");
        }
        
        // Validate password
        if (!password || password.length < 8) {
            throw new Error("Password must be at least 8 characters long");
        }
        
        // Claim invite code
        console.log("Claiming invite code...");
        let inviteCodeBlob;
        try {
            const response = await fetch(`${CONFIG.WALLET_API_BASE_URL}/api/consume_invite`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    code: inviteCode,
                    wallet: username,
                }),
            });
            
            if (!response.ok) {
                throw new Error(`Failed to claim invite code: ${response.statusText}`);
            }
            
            inviteCodeBlob = await response.json();
            console.log("Invite code claimed successfully");
        } catch (error) {
            throw new Error(`Failed to claim invite code: ${error.message}`);
        }
        
        const identity = `${username}@${CONFIG.WALLET_CONTRACT_NAME}`;
        const salted_password = `${password}:${salt}`;
        
        // Create blobs
        console.log("Creating blobs...");
        const blob0 = await check_secret_blob(identity, salted_password);
        const hash = Buffer.from(blob0.data).toString("hex");
        const blob1 = registerBlob(username, Date.now(), salt, hash, inviteCode);
        
        const blobTx = {
            identity,
            blobs: [blob0, blob1, inviteCodeBlob],
        };
        
        // Generate session key if requested
        let newSessionKey;
        if (enableSessionKey) {
            console.log("Generating session key...");
            const { duration = 24 * 60 * 60 * 1000, whitelist = [] } = {}; // 24 hours default
            const expiration = Date.now() + duration;
            newSessionKey = generateSessionKey(expiration, whitelist);
            blobTx.blobs.push(addSessionKeyBlob(username, newSessionKey.publicKey, expiration, whitelist));
        }
        
        // Register contract
        console.log("Registering contract...");
        await register_contract(nodeService);
        
        // Send blob transaction
        console.log("Sending blob transaction...");
        const txHash = await hashBlobTransaction(blobTx);
        console.log(`Blob transaction hash: ${txHash}`);
        
        // Send the actual blob transaction
        console.log("Sending blob transaction...", blobTx);
        await nodeService.sendBlobTx(blobTx);
        console.log("Blob transaction sent successfully");
        
        // Generate and send proof transaction
        console.log("Generating proof transaction...");
        const proofTx = await build_proof_transaction(identity, salted_password, txHash, 0, blobTx.blobs.length);
        
        console.log("Sending proof transaction...");
        const proofTxHash = await nodeService.sendProofTx(proofTx);
        console.log(`Proof transaction hash: ${proofTxHash}`);
        
        // Create wallet object
        const wallet = {
            username,
            address: identity,
            salt,
        };
        
        if (newSessionKey) {
            wallet.sessionKey = newSessionKey;
        }
        
        console.log("Account registration completed successfully!");
        console.log("Wallet:", JSON.stringify(wallet, null, 2));
        
        return { success: true, wallet };
        
    } catch (error) {
        console.error("Registration failed:", error);
        return { success: false, error: error.message };
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 3) {
        console.log("Usage: node hyli-wallet.js <username> <password> <inviteCode> [salt] [enableSessionKey]");
        console.log("");
        console.log("Arguments:");
        console.log("  username        - The username for the account");
        console.log("  password        - The password (must be at least 8 characters)");
        console.log("  inviteCode      - The invite code to use");
        console.log("  salt            - Optional salt (defaults to random string)");
        console.log("  enableSessionKey - Optional: 'true' to enable session key (default: false)");
        console.log("");
        console.log("Environment variables:");
        console.log("  NODE_BASE_URL   - Node service URL (default: http://localhost:4321)");
        console.log("  INDEXER_BASE_URL - Indexer service URL (default: http://localhost:4322)");
        console.log("");
        console.log("Example:");
        console.log("  NODE_BASE_URL=http://localhost:4321 INDEXER_BASE_URL=http://localhost:4322 node hyli-wallet.js myuser mypassword123 INVITE123");
        process.exit(1);
    }
    
    const [username, password, inviteCode, salt = Math.random().toString(36).substring(2), enableSessionKey = false] = args;
    
    console.log("Configuration:");
    console.log(`  Node URL: ${CONFIG.NODE_BASE_URL}`);
    console.log(`  Indexer URL: ${CONFIG.INDEXER_BASE_URL}`);
    console.log(`  Username: ${username}`);
    console.log(`  Salt: ${salt}`);
    console.log(`  Enable Session Key: ${enableSessionKey}`);
    console.log("");
    
    const result = await registerAccount(username, password, inviteCode, salt, enableSessionKey === 'true');
    
    if (result.success) {
        console.log("✅ Registration successful!");
        process.exit(0);
    } else {
        console.log("❌ Registration failed!");
        process.exit(1);
    }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(error => {
        console.error("Script execution failed:", error);
        process.exit(1);
    });
}

export { registerAccount };
