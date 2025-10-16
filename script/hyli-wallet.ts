#!/usr/bin/env node

import { Buffer } from "buffer";
import { NodeApiHttpClient, IndexerApiHttpClient, blob_builder, Blob, BlobTransaction } from "hyli";
import { check_secret } from "hyli-noir";
import EC from "elliptic";
import pkg from "js-sha3";
import {
    register as registerBlob,
    addSessionKey as addSessionKeyBlob,
    verifyIdentity,
    Wallet,
    AccountInfo,
} from "hyli-wallet";
import { BorshSchema, borshSerialize } from "borsher";

const { sha3_256 } = pkg;

// Type definitions
interface Config {
    NODE_BASE_URL: string;
    INDEXER_BASE_URL: string;
    WALLET_API_BASE_URL: string;
    WALLET_CONTRACT_NAME: string;
}

interface SessionKey {
    publicKey: string;
    privateKey: string;
    expiration: number;
    whitelist: string[];
}

interface RegistrationResult {
    success: boolean;
    wallet?: Wallet;
    error?: string;
}

interface TransferResult {
    success: boolean;
    transactionHash?: string;
    proofTransactionHash?: string;
    transfer?: {
        from: string;
        to: string;
        amount: number;
        token: string;
    };
    error?: string;
}

interface DeleteContractResult {
    success: boolean;
    transactionHash?: string;
    contractName?: string;
    error?: string;
}

// Configuration - update these values
const CONFIG: Config = {
    NODE_BASE_URL: process.env.NODE_BASE_URL || "http://localhost:4321",
    INDEXER_BASE_URL: process.env.INDEXER_BASE_URL || "http://localhost:4322",
    WALLET_API_BASE_URL: process.env.WALLET_API_BASE_URL || "http://localhost:4000",
    WALLET_CONTRACT_NAME: "wallet",
};

// Utility functions
const encodeToHex = (data: Uint8Array): string => {
    return Array.from(data)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
};

async function hashBlob(blob: Blob): Promise<string> {
    const contractBytes = new TextEncoder().encode(blob.contract_name);
    const dataBytes = new Uint8Array(blob.data);
    const input = new Uint8Array(contractBytes.length + dataBytes.length);
    input.set(contractBytes, 0);
    input.set(dataBytes, contractBytes.length);
    return encodeToHex(new Uint8Array(sha3_256.arrayBuffer(input)));
}

async function hashBlobTransaction(tx: BlobTransaction): Promise<string> {
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

// DeleteContractAction serialization
const deleteContractActionSchema = BorshSchema.Struct({
    contract_name: BorshSchema.String,
});

function deleteContractBlob(contractName: string): Blob {
    return {
        contract_name: "hyli",
        data: Array.from(borshSerialize(deleteContractActionSchema, { contract_name: contractName })),
    };
}

// Password validation function
async function validatePassword(username: string, password: string, accountInfo: AccountInfo): Promise<boolean> {
    const identity = `${username}@${CONFIG.WALLET_CONTRACT_NAME}`;

    if (!("Password" in accountInfo.auth_method)) {
        throw new Error("Account does not use password authentication");
    }

    const storedHash = accountInfo.auth_method.Password.hash;
    const storedSalt = accountInfo.salt;

    const salted_password = `${password}:${storedSalt}`;
    const computedHashHex = await check_secret.identity_hash(identity, salted_password);

    return computedHashHex === storedHash;
}

// Session key generation
function generateSessionKey(expiration: number, whitelist: string[] = []): SessionKey {
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
async function registerAccount(
    username: string,
    password: string,
    inviteCode: string,
    salt: string,
    enableSessionKey: boolean = false
): Promise<RegistrationResult> {
    console.log(`Starting registration for username: ${username}`);

    try {
        // Initialize services
        const nodeService = new NodeApiHttpClient(CONFIG.NODE_BASE_URL);

        // Check if account already exists
        let accountInfo: AccountInfo | undefined;
        try {
            const response = await fetch(
                `${CONFIG.WALLET_API_BASE_URL}/v1/indexer/contract/${CONFIG.WALLET_CONTRACT_NAME}/account/${username}`
            );
            if (!response.ok) {
                throw new Error(`Failed to check account existence: ${response.statusText}`);
            }
            accountInfo = await response.json();
        } catch (error) {
            // If error, assume account does not exist and continue
            console.log(`Account ${username} does not exist, proceeding with registration...`);
        }

        if (accountInfo) {
            console.log(`Account ${username} already exists`);
            return {
                success: true,
                wallet: {
                    username,
                    address: `${username}@${CONFIG.WALLET_CONTRACT_NAME}`,
                    salt: accountInfo.salt,
                },
            };
        }

        // Validate password
        if (!password || password.length < 8) {
            throw new Error("Password must be at least 8 characters long");
        }

        // Claim invite code
        console.log("Claiming invite code...");
        let inviteCodeBlob: Blob;
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
        } catch (error: any) {
            throw new Error(`Failed to claim invite code: ${error.message}`);
        }

        const identity = `${username}@${CONFIG.WALLET_CONTRACT_NAME}`;
        const salted_password = `${password}:${salt}`;

        // Create blobs
        console.log("Creating blobs...");
        const blob0 = await check_secret.build_blob(identity, salted_password);
        const hash = Buffer.from(blob0.data).toString("hex");
        const blob1 = registerBlob(username, Date.now(), salt, { Password: { hash: hash } }, inviteCode);

        const blobTx: BlobTransaction = {
            identity,
            blobs: [blob0, blob1, inviteCodeBlob],
        };

        // Generate session key if requested
        let newSessionKey: SessionKey | undefined;
        if (enableSessionKey) {
            console.log("Generating session key...");
            const { duration = 24 * 60 * 60 * 1000, whitelist = [] } = {}; // 24 hours default
            const expiration = Date.now() + duration;
            newSessionKey = generateSessionKey(expiration, whitelist);
            const sessionKeyNonce = Date.now();
            blobTx.blobs.push(addSessionKeyBlob(username, newSessionKey.publicKey, expiration, sessionKeyNonce, whitelist));
        }

        // Register contract
        console.log("Registering contract...");
        await check_secret.register_contract(nodeService);

        // Send blob transaction
        console.log("Sending blob transaction...");
        const txHash = await hashBlobTransaction(blobTx);
        console.log(`Blob transaction hash: ${txHash}`);

        // Send the actual blob transaction
        console.log("Sending blob transaction...");
        await nodeService.sendBlobTx(blobTx);
        console.log("Blob transaction sent successfully");

        // Generate and send proof transaction
        console.log("Generating proof transaction...");
        const proofTx = await check_secret.build_proof_transaction(
            identity,
            salted_password,
            txHash,
            0,
            blobTx.blobs.length
        );

        console.log("Sending proof transaction...");
        const proofTxHash = await nodeService.sendProofTx(proofTx);
        console.log(`Proof transaction hash: ${proofTxHash}`);

        // Create wallet object
        const wallet: Wallet = {
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
    } catch (error: any) {
        console.error("Registration failed:", error);
        return { success: false, error: error.message };
    }
}

// Transfer function
async function transferFunds(
    username: string,
    password: string,
    amount: string,
    token: string,
    destination: string
): Promise<TransferResult> {
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
        let accountInfo: AccountInfo;
        try {
            const response = await fetch(
                `${CONFIG.WALLET_API_BASE_URL}/v1/indexer/contract/${CONFIG.WALLET_CONTRACT_NAME}/account/${username}`
            );
            if (!response.ok) {
                throw new Error(`Failed to get account info: ${response.statusText}`);
            }

            accountInfo = await response.json();
            if (!accountInfo) {
                throw new Error(`Account with username "${username}" does not exist.`);
            }
        } catch (error: any) {
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
        let balance: number;
        try {
            const result = (await indexerService.get(
                `v1/indexer/contract/${token}/balance/${identity}`,
                "Checking balance"
            )) as { balance: number };
            balance = result.balance;
        } catch (error: any) {
            throw new Error(`Failed to get balance: ${error.message}. User might have no balance for this token.`);
        }
        console.log(`Balance for ${username} is`, balance);

        if (balance < parsedAmount) {
            throw new Error(`Account "${username}" does not have enough balance to transfer ${amount} ${token}`);
        }

        // Create blobs for transfer
        console.log("Creating transfer blobs...");
        const blob0 = await check_secret.build_blob(identity, salted_password);
        const blob1 = verifyIdentity(username, Date.now());
        const blob2 = blob_builder.smt_token.transfer(identity, destination, token, BigInt(parsedAmount), null);

        const blobTx: BlobTransaction = {
            identity,
            blobs: [blob0, blob1, blob2],
        };

        // Send blob transaction
        console.log("Sending blob transaction...");
        const txHash = await hashBlobTransaction(blobTx);
        console.log(`Blob transaction hash: ${txHash}`);

        // Send the actual blob transaction
        console.log("Sending blob transaction...");
        await nodeService.sendBlobTx(blobTx);
        console.log("Blob transaction sent successfully");

        // Generate and send proof transaction
        console.log("Generating proof transaction...");
        const proofTx = await check_secret.build_proof_transaction(
            identity,
            salted_password,
            txHash,
            0,
            blobTx.blobs.length
        );

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
                token: token,
            },
        };
    } catch (error: any) {
        console.error("Transfer failed:", error);
        return { success: false, error: error.message };
    }
}

// Delete contract function
async function deleteContract(password: string, contractName: string): Promise<DeleteContractResult> {
    console.log(`Starting contract deletion for: ${contractName}`);

    try {
        // Initialize services
        const nodeService = new NodeApiHttpClient(CONFIG.NODE_BASE_URL);

        let accountInfo: AccountInfo;
        try {
            const response = await fetch(
                `${CONFIG.WALLET_API_BASE_URL}/v1/indexer/contract/${CONFIG.WALLET_CONTRACT_NAME}/account/hyli`
            );
            accountInfo = await response.json();
        } catch (error: any) {
            throw new Error(`Failed to get account info for hyli@wallet: ${error.message}`);
        }
        if (!accountInfo) {
            throw new Error("hyli@wallet account does not exist");
        }

        // Use hyli@wallet as the admin account
        const username = "hyli";
        const identity = `${username}@${CONFIG.WALLET_CONTRACT_NAME}`;
        const salted_password = `${password}:${accountInfo.salt}`;

        // Create blobs
        console.log("Creating blobs...");
        const blob0 = await check_secret.build_blob(identity, salted_password);
        const blob1 = verifyIdentity(username, Date.now());

        // Create DeleteContractAction blob
        const actionBlob = deleteContractBlob(contractName);

        const emptyBlob: Blob = {
            contract_name: contractName,
            data: [],
        };

        const blobTx: BlobTransaction = {
            identity,
            blobs: [blob0, blob1, actionBlob, emptyBlob],
        };

        // Send blob transaction
        console.log("Sending blob transaction...");
        const txHash = await hashBlobTransaction(blobTx);
        console.log(`Blob transaction hash: ${txHash}`);

        console.log("Registering contract check_secret...");
        await check_secret.register_contract(nodeService);

        // Send the actual blob transaction
        await nodeService.sendBlobTx(blobTx);
        console.log("Blob transaction sent successfully");

        // Generate and send proof transaction
        console.log("Generating proof transaction...");
        const proofTx = await check_secret.build_proof_transaction(
            identity,
            salted_password,
            txHash,
            0,
            blobTx.blobs.length
        );

        console.log("Sending proof transaction...");
        const proofTxHash = await nodeService.sendProofTx(proofTx);
        console.log(`Proof transaction hash: ${proofTxHash}`);

        console.log(`Contract deletion request for "${contractName}" completed successfully!`);

        return {
            success: true,
            transactionHash: txHash,
            contractName: contractName,
        };
    } catch (error: any) {
        console.error("Contract deletion failed:", error);
        return { success: false, error: error.message };
    }
}

// CLI interface
async function main(): Promise<void> {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        showUsage();
        process.exit(1);
    }

    const command = args[0];

    if (command === "register") {
        await handleRegisterCommand(args.slice(1));
    } else if (command === "transfer") {
        await handleTransferCommand(args.slice(1));
    } else if (command === "delete_contract") {
        await handleDeleteContractCommand(args.slice(1));
    } else {
        console.log(`Unknown command: ${command}`);
        showUsage();
        process.exit(1);
    }
}

function showUsage(): void {
    console.log("Usage: hyli-wallet <command> [options]");
    console.log("");
    console.log("Commands:");
    console.log("  register <username> <password> <inviteCode> [salt] [enableSessionKey]");
    console.log("  transfer <username> <password> <amount> <token> <destination>");
    console.log("  delete_contract <password> <contractName>");
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
    console.log("Delete Contract command (admin only):");
    console.log("  contractName    - The name of the contract to delete");
    console.log("  password        - The password for hyli@wallet account");
    console.log("");
    console.log("Environment variables:");
    console.log("  NODE_BASE_URL   - Node service URL (default: http://localhost:4321)");
    console.log("  INDEXER_BASE_URL - Indexer service URL (default: http://localhost:4322)");
    console.log("  WALLET_API_BASE_URL - Wallet API URL (default: http://localhost:4000)");
    console.log("");
    console.log("Examples:");
    console.log("  hyli-wallet register myuser mypassword123 INVITE123");
    console.log("  hyli-wallet transfer myuser mypassword123 100 oranj otheruser@wallet");
    console.log("  hyli-wallet delete_contract adminpassword mycontract");
    console.log("  NODE_BASE_URL=http://localhost:4321 hyli-wallet register myuser mypassword123 INVITE123");
}

async function handleRegisterCommand(args: string[]): Promise<void> {
    if (args.length < 3) {
        console.log("Register command requires at least 3 arguments: username, password, inviteCode");
        console.log("Usage: hyli-wallet register <username> <password> <inviteCode> [salt] [enableSessionKey]");
        process.exit(1);
    }

    const [username, password, inviteCode, salt = Math.random().toString(36).substring(2), enableSessionKey = "false"] =
        args;

    console.log("Configuration:");
    console.log(`  Node URL: ${CONFIG.NODE_BASE_URL}`);
    console.log(`  Indexer URL: ${CONFIG.INDEXER_BASE_URL}`);
    console.log(`  Wallet API URL: ${CONFIG.WALLET_API_BASE_URL}`);
    console.log(`  Username: ${username}`);
    console.log(`  Salt: ${salt}`);
    console.log(`  Enable Session Key: ${enableSessionKey}`);
    console.log("");

    const result = await registerAccount(username, password, inviteCode, salt, enableSessionKey === "true");

    if (result.success) {
        console.log("✅ Registration successful!");
        process.exit(0);
    } else {
        console.log("❌ Registration failed!");
        process.exit(1);
    }
}

async function handleTransferCommand(args: string[]): Promise<void> {
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

async function handleDeleteContractCommand(args: string[]): Promise<void> {
    if (args.length < 2) {
        console.log("Delete contract command requires 2 arguments: password, contractName");
        console.log("Usage: hyli-wallet delete_contract <contractName> <password>");
        process.exit(1);
    }

    const [contractName, password] = args;

    console.log("Configuration:");
    console.log(`  Node URL: ${CONFIG.NODE_BASE_URL}`);
    console.log(`  Indexer URL: ${CONFIG.INDEXER_BASE_URL}`);
    console.log(`  Wallet API URL: ${CONFIG.WALLET_API_BASE_URL}`);
    console.log(`  Contract to delete: ${contractName}`);
    console.log(`  Admin account: hyli@wallet`);
    console.log("");

    const result = await deleteContract(password, contractName);

    if (result.success) {
        console.log("✅ Contract deletion request successful!");
        console.log(`Transaction Hash: ${result.transactionHash}`);
        console.log(`Contract: ${result.contractName}`);
        process.exit(0);
    } else {
        console.log("❌ Contract deletion failed!");
        process.exit(1);
    }
}

// Run the script
// Check if this is the main module being executed
if (import.meta.url.endsWith("hyli-wallet.js") || process.argv[1].includes("hyli-wallet")) {
    main().catch((error) => {
        console.error("Script execution failed:", error);
        process.exit(1);
    });
}

export { registerAccount, transferFunds, deleteContract };
