import { Buffer } from "buffer";
import {
    AuthProvider,
    AuthCredentials,
    AuthResult,
    AuthEvents,
    RegisterAccountParams,
    LoginParams,
} from "./BaseAuthProvider";
import {
    Wallet,
    WalletErrorCallback,
    WalletEventCallback,
    addSessionKeyBlob,
    registerBlob,
    verifyIdentityBlob,
    walletContractName,
} from "../types/wallet";
import { NodeService } from "../services/NodeService";
import { webSocketService } from "../services/WebSocketService";
import {
    build_proof_transaction,
    build_blob as check_secret_blob,
    register_contract,
    sha256,
    stringToBytes,
} from "hyli-check-secret";
import { BlobTransaction } from "hyli";
import * as WalletOperations from "../services/WalletOperations";
import { IndexerService } from "../services/IndexerService";
import { sessionKeyService } from "../services/SessionKeyService";
import { hashBlobTransaction } from "../utils/hash";

export interface PasswordAuthCredentials extends AuthCredentials {
    password: string;
    confirmPassword?: string;
    salt: string;
}

export class PasswordAuthProvider implements AuthProvider {
    type = "password";

    isEnabled(): boolean {
        return true;
    }

    async login({
        credentials,
        onWalletEvent,
        onError,
        registerSessionKey,
    }: LoginParams<PasswordAuthCredentials>): Promise<AuthResult> {
        const indexerService = IndexerService.getInstance();
        const { username, password, salt } = credentials;
        const identity = `${username}@${walletContractName}`;
        let getSessKey;
        if (registerSessionKey)
            getSessKey = WalletOperations.getOrReuseSessionKey({
                username,
                address: identity,
                salt,
            });

        try {
            if (!username || !password) {
                return { success: false, error: "Please fill in all fields" };
            }

            if (password.length < 8) {
                return { success: false, error: "Password must be at least 8 characters long" };
            }

            onWalletEvent?.({ account: identity, type: "checking_password", message: `Checking password for log in` });

            const userAccountInfo = await indexerService.getAccountInfo(username);
            let storedHash = userAccountInfo.auth_method.Password.hash;
            let storedSalt = userAccountInfo.salt;

            let salted_password = `${password}:${storedSalt}`;
            const hashed_password_bytes = await sha256(stringToBytes(salted_password));
            let encoder = new TextEncoder();
            let id_prefix = encoder.encode(`${identity}:`);
            let extended_id = new Uint8Array([...id_prefix, ...hashed_password_bytes]);
            const computedHash = await sha256(extended_id);
            const computedHashHex = Buffer.from(computedHash).toString("hex");

            if (computedHashHex != storedHash) {
                onError?.(new Error("Invalid password"));
                return { success: false, error: "Invalid password" };
            }

            // Create initial wallet state
            const wallet: Wallet = {
                username,
                address: identity,
                salt,
            };

            if (getSessKey) {
                try {
                    const sessionKey = await getSessKey;
                    if (sessionKey) wallet.sessionKey = sessionKey;
                    else {
                        let res = await WalletOperations.registerSessionKey(
                            wallet,
                            salted_password,
                            Date.now() + registerSessionKey!.duration,
                            registerSessionKey!.whitelist,
                            registerSessionKey!.laneId,
                            onWalletEvent,
                            onError
                        );
                        wallet.sessionKey = res.sessionKey;
                    }
                } catch (error) {}
            }

            return { success: true, wallet };
        } catch (errorMessage) {
            const error =
                errorMessage instanceof Error ? errorMessage.message : "Invalid credentials or wallet does not exist";
            onError?.(new Error(error));
            return {
                success: false,
                error: error,
            };
        }
    }

    async register({
        credentials,
        onWalletEvent,
        onError,
        registerSessionKey,
    }: RegisterAccountParams<PasswordAuthCredentials>): Promise<AuthResult> {
        const nodeService = NodeService.getInstance();
        try {
            const { username, password, confirmPassword, inviteCode, salt } = credentials;

            const indexerService = IndexerService.getInstance();
            try {
                const accountInfo = await indexerService.getAccountInfo(username);
                if (accountInfo) {
                    const error = `Account with username "${username}" already exists.`;
                    onError?.(new Error(error));
                    return { success: false, error: error };
                }
            } catch (error) {
                // If error, assume account does not exist and continue
            }

            if (!username || !password || !confirmPassword) {
                return { success: false, error: "Please fill in all fields" };
            }

            if (password !== confirmPassword) {
                return { success: false, error: "Passwords do not match" };
            }

            if (password.length < 8) {
                return {
                    success: false,
                    error: "Password must be at least 8 characters long",
                };
            }

            let inviteCodeBlob;
            try {
                inviteCodeBlob = await indexerService.claimInviteCode(inviteCode, username);
            } catch (error) {
                console.warn("Failed to claim invite code:", error);
                return {
                    success: false,
                    error: `Failed to claim invite code.`,
                };
            }

            const identity = `${username}@${walletContractName}`;

            let salted_password = `${password}:${salt}`;
            const blob0 = await check_secret_blob(identity, salted_password);
            const hash = Buffer.from(blob0.data).toString("hex");
            const blob1 = registerBlob(username, Date.now(), salt, hash, inviteCode);

            const blobTx: BlobTransaction = {
                identity,
                blobs: [blob0, blob1, inviteCodeBlob],
            };

            let newSessionKey;
            if (registerSessionKey) {
                const { duration, whitelist } = registerSessionKey;
                const expiration = Date.now() + duration; // still in milliseconds
                newSessionKey = sessionKeyService.generateSessionKey(expiration, whitelist);
                blobTx.blobs.push(addSessionKeyBlob(username, newSessionKey.publicKey, expiration, whitelist));
            }

            onWalletEvent?.({
                account: identity,
                type: "custom",
                message: `Making sure contract is registered`,
            });

            await register_contract(nodeService.client as any);

            onWalletEvent?.({ account: identity, type: "sending_blob", message: `Sending blob transaction` });
            // Skipped, to make sure we send the proof alongside.
            const txHash = await hashBlobTransaction(blobTx);
            //const txHash = await nodeService.client.sendBlobTx(blobTx);
            onWalletEvent?.({ account: identity, type: "blob_sent", message: `Blob transaction sent: ${txHash}` });

            // Create initial wallet state
            const wallet: Wallet = {
                username,
                address: identity,
                salt,
            };

            onWalletEvent?.({ account: identity, type: "custom", message: `Generating proof of password` });

            // Build and send the proof transaction
            const proofTx = await build_proof_transaction(identity, salted_password, txHash, 0, blobTx.blobs.length);

            onWalletEvent?.({ account: identity, type: "sending_proof", message: `Sending proof transaction` });
            await nodeService.client.sendBlobTx(blobTx);
            const proofTxHash = await nodeService.client.sendProofTx(proofTx);
            onWalletEvent?.({
                account: identity,
                type: "proof_sent",
                message: `Proof transaction sent: ${proofTxHash}`,
            });

            // // Wait for on-chain settlement
            // await new Promise((resolve, reject) => {
            //     const timeout = setTimeout(() => {
            //         webSocketService.unsubscribeFromWalletEvents();
            //         reject(new Error("Wallet creation timed out"));
            //     }, 60000);

            //     webSocketService.connect(identity);
            //     const unsubscribeWalletEvents = webSocketService.subscribeToWalletEvents((event) => {
            //         const msg = event.event.toLowerCase();
            //         if (msg.startsWith("successfully registered identity")) {
            //             clearTimeout(timeout);
            //             unsubscribeWalletEvents();
            //             webSocketService.disconnect();
            //             resolve(event);
            //         } else if (msg.includes("failed") || msg.includes("error")) {
            //             clearTimeout(timeout);
            //             unsubscribeWalletEvents();
            //             webSocketService.disconnect();
            //             reject(new Error(`${event.event}: ${txHash})`));
            //         }
            //     });
            // });

            if (newSessionKey) {
                wallet.sessionKey = newSessionKey;
            }
            // Create clean wallet state after registration
            const cleanedWallet = WalletOperations.cleanExpiredSessionKeys(wallet);
            return { success: true, wallet: cleanedWallet };
        } catch (errorMessage) {
            const error = errorMessage instanceof Error ? errorMessage.message : "Failed to register wallet";
            console.log("Registration error:", errorMessage);
            onError?.(new Error(error));
            return {
                success: false,
                error: error,
            };
        }
    }
}
