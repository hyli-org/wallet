#!/usr/bin/env node

import { Buffer } from "buffer";
import { NodeApiHttpClient, IndexerApiHttpClient, blob_builder } from "hyli";
import { build_proof_transaction, build_blob as check_secret_blob, register_contract, sha256, stringToBytes } from "hyli-check-secret";
import EC from "elliptic";
import pkg from "js-sha3";
import { register as registerBlob, addSessionKey as addSessionKeyBlob, verifyIdentity } from "hyli-wallet";
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

// Password validation function
async function validatePassword(username, password, accountInfo) {
    const identity = `${username}@${CONFIG.WALLET_CONTRACT_NAME}`;
    const storedHash = accountInfo.auth_method.Password.hash;
    const storedSalt = accountInfo.salt;
    
    const salted_password = `${password}:${storedSalt}`;
    const hashed_password_bytes = await sha256(stringToBytes(salted_password));
    const encoder = new TextEncoder();
    const id_prefix = encoder.encode(`${identity}:`);
    const extended_id = new Uint8Array([...id_prefix, ...hashed_password_bytes]);
    const computedHash = await sha256(extended_id);
    const computedHashHex = Buffer.from(computedHash).toString("hex");
    
    return computedHashHex === storedHash;
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
        
        // Check if account already exists
        try {
            const response = await fetch(`${CONFIG.WALLET_API_BASE_URL}/v1/indexer/contract/${CONFIG.WALLET_CONTRACT_NAME}/account/${username}`);

            if (!response.ok) {
                throw new Error(`Failed to check account existence: ${response.statusText}`);
            }
            
            const accountInfo = await response.json();

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

// Transfer function
async function transferFunds(username, password, amount, token, destination) {
    console.log(`Starting transfer from ${username} to ${destination}`);
    console.log(`Amount: ${amount} ${token}`);
    
    try {
        // Initialize services
        const nodeService = new NodeApiHttpClient(CONFIG.NODE_BASE_URL);
        const indexerService = new IndexerApiHttpClient(CONFIG.INDEXER_BASE_URL);
        
        // Validate inputs
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            throw new Error("Amount must be a positive number");
        }
        
        if (!token || !destination) {
            throw new Error("Token and destination are required");
        }
        
        // Check if account exists and get account info
        console.log("Checking account information...");
        let accountInfo;
        try {
            const response = await fetch(`${CONFIG.WALLET_API_BASE_URL}/v1/indexer/contract/${CONFIG.WALLET_CONTRACT_NAME}/account/${username}`);
            if (!response.ok) {
                throw new Error(`Failed to get account info: ${response.statusText}`);
            }
            
            accountInfo = await response.json();
            if (!accountInfo) {
                throw new Error(`Account with username "${username}" does not exist.`);
            }
        } catch (error) {
            throw new Error(`Failed to get account info: ${error.message}`);
        }
        
        // Validate password
        console.log("Validating password...");
        const isPasswordValid = await validatePassword(username, password, accountInfo);
        if (!isPasswordValid) {
            throw new Error("Invalid password");
        }

        const identity = `${username}@${CONFIG.WALLET_CONTRACT_NAME}`;
        const salted_password = `${password}:${accountInfo.salt}`;
        

        // Check that account has enough balance
        console.log("Checking balance...");
        try {
            const balance = await indexerService.get(`v1/indexer/contract/${token}/balance/${identity}`, "Checking balance");
            console.log("Balance...", balance);
            if (balance < parsedAmount) {
                throw new Error(`Account "${username}" does not have enough balance to transfer ${amount} ${token}`);
            }
        } catch (error) {
            throw new Error(`Failed to get balance: ${error.message}. User might have no balance for this token.`);
        }
        
        // Create blobs for transfer
        console.log("Creating transfer blobs...");
        const blob0 = await check_secret_blob(identity, salted_password);
        const blob1 = verifyIdentity(username, Date.now());
        const blob2 = blob_builder.smt_token.transfer(identity, destination, token, BigInt(parsedAmount), null);
        
        const blobTx = {
            identity,
            blobs: [blob0, blob1, blob2],
        };
        
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
        
        console.log("Transfer completed successfully!");
        console.log(`Transferred ${amount} ${token} from ${username} to ${destination}`);
        
        return { 
            success: true, 
            transactionHash: txHash,
            proofTransactionHash: proofTxHash,
            transfer: {
                from: username,
                to: destination,
                amount: parsedAmount,
                token: token
            }
        };
        
    } catch (error) {
        console.error("Transfer failed:", error);
        return { success: false, error: error.message };
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        showUsage();
        process.exit(1);
    }
    
    const command = args[0];
    
    if (command === 'register') {
        await handleRegisterCommand(args.slice(1));
    } else if (command === 'transfer') {
        await handleTransferCommand(args.slice(1));
    } else {
        console.log(`Unknown command: ${command}`);
        showUsage();
        process.exit(1);
    }
}

function showUsage() {
    console.log("Usage: hyli-wallet <command> [options]");
    console.log("");
    console.log("Commands:");
    console.log("  register <username> <password> <inviteCode> [salt] [enableSessionKey]");
    console.log("  transfer <username> <password> <amount> <token> <destination>");
    console.log("");
    console.log("Register command:");
    console.log("  username        - The username for the account");
    console.log("  password        - The password (must be at least 8 characters)");
    console.log("  inviteCode      - The invite code to use");
    console.log("  salt            - Optional salt (defaults to random string)");
    console.log("  enableSessionKey - Optional: 'true' to enable session key (default: false)");
    console.log("");
    console.log("Transfer command:");
    console.log("  username        - The username of the sender account");
    console.log("  password        - The password for the sender account");
    console.log("  amount          - The amount to transfer (positive number)");
    console.log("  token           - The token/currency to transfer (e.g., 'oranj')");
    console.log("  destination     - The destination address or username");
    console.log("");
    console.log("Environment variables:");
    console.log("  NODE_BASE_URL   - Node service URL (default: http://localhost:4321)");
    console.log("  INDEXER_BASE_URL - Indexer service URL (default: http://localhost:4322)");
    console.log("  WALLET_API_BASE_URL - Wallet API URL (default: http://localhost:4000)");
    console.log("");
    console.log("Examples:");
    console.log("  hyli-wallet register myuser mypassword123 INVITE123");
    console.log("  hyli-wallet transfer myuser mypassword123 100 oranj otheruser@wallet");
    console.log("  NODE_BASE_URL=http://localhost:4321 hyli-wallet register myuser mypassword123 INVITE123");
}

async function handleRegisterCommand(args) {
    if (args.length < 3) {
        console.log("Register command requires at least 3 arguments: username, password, inviteCode");
        console.log("Usage: hyli-wallet register <username> <password> <inviteCode> [salt] [enableSessionKey]");
        process.exit(1);
    }
    
    const [username, password, inviteCode, salt = Math.random().toString(36).substring(2), enableSessionKey = false] = args;
    
    console.log("Configuration:");
    console.log(`  Node URL: ${CONFIG.NODE_BASE_URL}`);
    console.log(`  Indexer URL: ${CONFIG.INDEXER_BASE_URL}`);
    console.log(`  Wallet API URL: ${CONFIG.WALLET_API_BASE_URL}`);
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

async function handleTransferCommand(args) {
    if (args.length < 5) {
        console.log("Transfer command requires 5 arguments: username, password, amount, token, destination");
        console.log("Usage: hyli-wallet transfer <username> <password> <amount> <token> <destination>");
        process.exit(1);
    }
    
    const [username, password, amount, token, destination] = args;
    
    console.log("Configuration:");
    console.log(`  Node URL: ${CONFIG.NODE_BASE_URL}`);
    console.log(`  Indexer URL: ${CONFIG.INDEXER_BASE_URL}`);
    console.log(`  Wallet API URL: ${CONFIG.WALLET_API_BASE_URL}`);
    console.log(`  From: ${username}`);
    console.log(`  To: ${destination}`);
    console.log(`  Amount: ${amount} ${token}`);
    console.log("");
    
    const result = await transferFunds(username, password, amount, token, destination);
    
    if (result.success) {
        console.log("✅ Transfer successful!");
        console.log(`Transaction Hash: ${result.transactionHash}`);
        console.log(`Proof Transaction Hash: ${result.proofTransactionHash}`);
        process.exit(0);
    } else {
        console.log("❌ Transfer failed!");
        process.exit(1);
    }
}

// Run the script
// Check if this is the main module being executed
if (import.meta.url.endsWith('hyli-wallet.js') || process.argv[1].includes('hyli-wallet')) {
    main().catch(error => {
        console.error("Script execution failed:", error);
        process.exit(1);
    });
}

export { registerAccount, transferFunds };
