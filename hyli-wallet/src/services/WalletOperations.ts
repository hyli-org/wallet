import {
    addSessionKeyBlob,
    type Wallet,
    walletContractName,
    type WalletAction,
    type TransactionCallback,
    serializeSecp256k1Blob,
    serializeIdentityAction,
    removeSessionKeyBlob,
    SessionKey,
    WalletEventCallback,
    WalletErrorCallback,
} from "../types/wallet";
import { sessionKeyService } from "./SessionKeyService";
import { build_proof_transaction, build_blob as check_secret_blob } from "hyli-check-secret";
import { Blob, BlobTransaction } from "hyli";
import { NodeService } from "./NodeService";
import { IndexerService } from "./IndexerService";

/**
 * Registers a new session key in the wallet and sends transactions to register it.
 * @param wallet The wallet to update
 * @param password The password (for signing)
 * @param expiration Key expiration timestamp
 * @param whitelist List of allowed operations for this key
 * @returns Object containing transaction hashes and optimistic wallet update
 */
export const registerSessionKey = async (
    wallet: Wallet,
    password: string,
    expiration: number,
    whitelist: string[],
    onWalletEvent?: WalletEventCallback,
    onError?: WalletErrorCallback
): Promise<{
    sessionKey: SessionKey;
    txHashes: [string, string];
    updatedWallet: Wallet;
}> => {
    const nodeService = NodeService.getInstance();

    // Create the new session key
    const newSessionKey = sessionKeyService.generateSessionKey(expiration, whitelist);
    const accountName = wallet.username;

    // Register the session key with the service
    try {
        const identity = `${accountName}@${walletContractName}`;
        const blob0 = await check_secret_blob(identity, password);
        const blob1 = addSessionKeyBlob(accountName, newSessionKey.publicKey, expiration, whitelist);

        const blobTx: BlobTransaction = {
            identity,
            blobs: [blob0, blob1],
        };

        // Send transaction to add session key
        const blobTxHash = await nodeService.client.sendBlobTx(blobTx);
        // Notify of blob transaction
        onWalletEvent?.({ account: identity, event: `Blob transaction sent: ${blobTxHash}` });

        const proofTx = await build_proof_transaction(identity, password, blobTxHash, 0, blobTx.blobs.length);

        const proofTxHash = await nodeService.client.sendProofTx(proofTx);
        // Notify of proof transaction
        onWalletEvent?.({ account: identity, event: `Proof transaction sent: ${proofTxHash}` });

        // Create optimistic wallet update
        const updatedWallet = {
            ...wallet,
            sessionKey: newSessionKey,
        };

        // TODO(?): Add a websocket listener to confirm the transaction

        return {
            sessionKey: newSessionKey,
            txHashes: [blobTxHash, proofTxHash],
            updatedWallet,
        };
    } catch (errorMessage) {
        const error = errorMessage instanceof Error ? errorMessage.message : "Failed to register session key";
        onError?.(new Error(error));
        console.error("Failed to initialize session key:", errorMessage);
        throw error;
    }
};

/**
 * Remove a session key in the wallet and sends transactions to remove it.
 * @param wallet The wallet to update
 * @param password The password (for signing)
 * @param publicKey The key to remove
 * @returns Object containing transaction hashes and optimistic wallet update
 */
export const removeSessionKey = async (
    wallet: Wallet,
    password: string,
    publicKey: string,
    onWalletEvent?: WalletEventCallback,
    onError?: WalletErrorCallback
): Promise<{
    txHashes: [string, string];
    updatedWallet: Wallet;
}> => {
    const nodeService = NodeService.getInstance();

    const accountName = wallet.username;

    // Remove the session key with the service
    try {
        const identity = `${accountName}@${walletContractName}`;

        const blob0 = await check_secret_blob(identity, password);
        const blob1 = removeSessionKeyBlob(wallet.username, publicKey);

        const blobTx: BlobTransaction = {
            identity,
            blobs: [blob0, blob1],
        };

        // Send transaction to remove session key
        const blobTxHash = await nodeService.client.sendBlobTx(blobTx);
        // Notify of blob transaction
        onWalletEvent?.({ account: identity, event: `Blob transaction sent: ${blobTxHash}` });

        const proofTx = await build_proof_transaction(identity, password, blobTxHash, 0, blobTx.blobs.length);

        const proofTxHash = await nodeService.client.sendProofTx(proofTx);
        // Notify of proof transaction
        onWalletEvent?.({ account: identity, event: `Proof transaction sent: ${proofTxHash}` });

        // Create optimistic wallet update
        let updatedWallet: Wallet;
        if (wallet.sessionKey && wallet.sessionKey.publicKey === publicKey) {
            updatedWallet = {
                username: wallet.username,
                address: wallet.address,
            };
        } else {
            updatedWallet = { ...wallet };
        }

        // TODO(?): Add a websocket listener to confirm the transaction

        return {
            txHashes: [blobTxHash, proofTxHash],
            updatedWallet,
        };
        // } catch (error) {
        //     console.error("Failed to remove session key:", error);
        //     throw error;
        // }
    } catch (errorMessage) {
        const error = errorMessage instanceof Error ? errorMessage.message : "Failed to remove session key";
        onError?.(new Error(error));
        console.error("Failed to remove session key:", errorMessage);
        throw error;
    }
};

/**
 * Creates signed blobs using a session key
 * @param wallet The wallet containing the session key
 * @returns [blob1, blob2] The signed blobs
 */
export const createIdentityBlobs = (wallet: Wallet): [Blob, Blob] => {
    if (!wallet.sessionKey) {
        throw new Error("No session key found. Please register a session key first.");
    }
    const sessionKey = wallet.sessionKey;

    if (sessionKey.expiration < Date.now()) {
        throw new Error("Session key expired. Please register a new session key.");
    }

    let nonce = Date.now();
    const secp256k1Blob = sessionKeyService.getSignedBlob(wallet.address, nonce, sessionKey.privateKey);

    const blob0: Blob = {
        contract_name: "secp256k1",
        data: serializeSecp256k1Blob(secp256k1Blob),
    };

    const action: WalletAction = {
        UseSessionKey: {
            account: wallet.username,
            key: sessionKey.publicKey,
            nonce,
        },
    };
    const blob1: Blob = {
        contract_name: walletContractName,
        data: serializeIdentityAction(action),
    };

    return [blob0, blob1];
};

/**
 * Cleans expired session keys from the wallet
 * @param wallet The wallet to clean
 * @returns The updated wallet
 */
export const cleanExpiredSessionKeys = (wallet: Wallet): Wallet => {
    if (!wallet.sessionKey) {
        return wallet;
    }
    if (wallet.sessionKey.expiration < Date.now()) {
        // Remove expired keys from wallet
        const updatedWallet = {
            username: wallet.username,
            address: wallet.address,
        };
        return updatedWallet;
    }
    return wallet;
};

export const getOrReuseSessionKey = async (
    wallet: Wallet,
    checkBackend: boolean = false
): Promise<SessionKey | undefined> => {
    // Check if a session key exists and is not expired
    const now = Date.now();
    if (wallet.sessionKey && wallet.sessionKey.expiration > now) {
        // Optionally check with backend if the session key is still valid
        if (checkBackend) {
            try {
                const indexer = IndexerService.getInstance();
                const accountInfo = await indexer.getAccountInfo(wallet.address);
                const backendKey = accountInfo.session_keys.find(
                    (k) => k.key === wallet.sessionKey!.publicKey && k.expiration_date > now
                );
                if (backendKey) {
                    return wallet.sessionKey;
                }
            } catch (e) {
                // fallback to not reused
            }
        } else {
            return wallet.sessionKey;
        }
    }
    // No valid session key available
    return undefined;
};
