import { Buffer } from "buffer";
import { AuthProvider, AuthCredentials, AuthResult, AuthEvents } from "./BaseAuthProvider";
import { Wallet, WalletErrorCallback, WalletEventCallback, addSessionKeyBlob, registerBlob, verifyIdentityBlob, walletContractName } from "../types/wallet";
import { NodeService } from "../services/NodeService";
import { webSocketService } from "../services/WebSocketService";
import { build_proof_transaction, build_blob as check_secret_blob, register_contract, sha256, stringToBytes } from "hyli-check-secret";
import { BlobTransaction } from "hyli";
import * as WalletOperations from "../services/WalletOperations";
import { IndexerService } from "../services/IndexerService";

export interface PasswordAuthCredentials extends AuthCredentials {
    password: string;
    confirmPassword?: string;
}

export class PasswordAuthProvider implements AuthProvider {
    type = "password";

    isEnabled(): boolean {
        return true;
    }

    async login(
        credentials: PasswordAuthCredentials,
        onWalletEvent?: WalletEventCallback,
        onError?: WalletErrorCallback
    ): Promise<AuthResult> {
        const indexerService = IndexerService.getInstance();
        const { username, password } = credentials;
        const identity = `${username}@${walletContractName}`;
        try {
            if (!username || !password) {
                return { success: false, error: "Please fill in all fields" };
            }
            const userAccountInfo = await indexerService.getAccountInfo(username);
            let storedHash = userAccountInfo.auth_method.Password.hash;
            
            const hashed_password_bytes = await sha256(stringToBytes(password));
            let encoder = new TextEncoder();
            let id_prefix = encoder.encode(`${identity}:`);
            let extended_id = new Uint8Array([...id_prefix, ...hashed_password_bytes]);
            const computedHash = await sha256(extended_id);
            const computedHashHex = Buffer.from(computedHash).toString("hex");

            if (computedHashHex != storedHash) {
                onError?.(new Error("Invalid password"));
                return { success: false, error: "Invalid password" };
            }
        } catch (errorMessage) {
            const error = errorMessage instanceof Error ? errorMessage.message : "Invalid credentials or wallet does not exist"
            onError?.(new Error(error));
            return {
                success: false,
                error: error,
            };
        }

        // Create initial wallet state
        const wallet: Wallet = {
            username,
            address: identity,
        };
        return { success: true, wallet };
    }

    async register(
        credentials: PasswordAuthCredentials,
        onWalletEvent?: WalletEventCallback,
        onError?: WalletErrorCallback
    ): Promise<AuthResult> {
        const nodeService = NodeService.getInstance();
        try {
            const { username, password, confirmPassword } = credentials;

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

            const identity = `${username}@${walletContractName}`;
            const blob0 = await check_secret_blob(identity, password);
            const hash = Buffer.from(blob0.data).toString("hex");
            const blob1 = registerBlob(username, Date.now(), hash);

            const blobTx: BlobTransaction = {
                identity,
                blobs: [blob0, blob1],
            };

            await register_contract(nodeService.client as any);
            const txHash = await nodeService.client.sendBlobTx(blobTx);
            onWalletEvent?.({ account: identity, event: `Blob transaction sent: ${txHash}` });

            // Create initial wallet state
            const wallet: Wallet = {
                username,
                address: identity,
            };


            // Build and send the proof transaction
            const proofTx = await build_proof_transaction(identity, password, txHash, 0, blobTx.blobs.length);

            const proofTxHash = await nodeService.client.sendProofTx(proofTx);
            onWalletEvent?.({ account: identity, event: `Proof transaction sent: ${proofTxHash}` });

            // Wait for on-chain settlement
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    webSocketService.unsubscribeFromWalletEvents();
                    reject(new Error("Wallet creation timed out"));
                }, 60000);

                webSocketService.connect(identity);
                const unsubscribeWalletEvents = webSocketService.subscribeToWalletEvents((event) => {
                    const msg = event.event.toLowerCase();
                    if (msg.startsWith("successfully registered identity")) {
                        clearTimeout(timeout);
                        unsubscribeWalletEvents();
                        webSocketService.disconnect();
                        resolve(event);
                    } else if (msg.includes("failed") || msg.includes("error")) {
                        clearTimeout(timeout);
                        unsubscribeWalletEvents();
                        webSocketService.disconnect();
                        reject(new Error(`${event.event}: ${txHash})`));
                    }
                });
            });

            // Create clean wallet state after registration
            const cleanedWallet = WalletOperations.cleanExpiredSessionKeys(wallet);
            return { success: true, wallet: cleanedWallet };
        } catch (errorMessage) {
            const error = errorMessage instanceof Error ? errorMessage.message : "Failed to register wallet"
            console.log("Registration error:", errorMessage);
            onError?.(new Error(error));
            return {
                success: false,
                error: error,
            };
        }
    }
}
