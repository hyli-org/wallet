import { AuthProvider, LoginParams, RegisterAccountParams } from "./BaseAuthProvider";
import {
    Wallet,
    addSessionKeyBlob,
    registerBlob,
    walletContractName,
    WalletErrorCallback,
    Secp256k1Blob,
    serializeSecp256k1Blob,
    verifyIdentityBlob,
} from "../types/wallet";
import { NodeService } from "../services/NodeService";
import { IndexerService } from "../services/IndexerService";
import * as WalletOperations from "../services/WalletOperations";
import { sessionKeyService } from "../services/SessionKeyService";
import { BlobTransaction } from "hyli";
import { encodeToHex, hashBlobTransaction } from "../utils/hash";
import { AuthCredentials, AuthResult } from "../types/auth";
import { qrSigningService, QRSigningRequest } from "../services/QRSigningService";
import { keccak256 } from "../utils/keccak";
import { decompressPublicKey } from "../utils/secp256k1";

export interface HyliAppAuthCredentials extends AuthCredentials {
    inviteCode?: string;
}

export interface HyliAppAuthProviderOptions {
    wsUrl?: string;
}

export type QRSigningCallback = (request: QRSigningRequest, qrData: string) => void;
export type QRStatusCallback = (status: "waiting" | "received" | "error" | "timeout", error?: string) => void;

export interface QRConnectionResult {
    signature: Uint8Array;
    publicKey: Uint8Array;
    address: string;
}

export class HyliAppAuthProvider implements AuthProvider<HyliAppAuthCredentials> {
    readonly type = "hyliapp";
    private wsUrl?: string;

    // Callbacks for QR display - set by the UI component
    private qrSigningCallback?: QRSigningCallback;
    private qrStatusCallback?: QRStatusCallback;

    constructor(options?: HyliAppAuthProviderOptions) {
        this.wsUrl = options?.wsUrl;
        if (this.wsUrl) {
            qrSigningService.setWsUrl(this.wsUrl);
        }
    }

    /**
     * Set the WebSocket URL for QR signing
     */
    setWsUrl(url: string) {
        this.wsUrl = url;
        qrSigningService.setWsUrl(url);
    }

    /**
     * Set callbacks for QR code display and status updates
     */
    setQRCallbacks(onQRReady: QRSigningCallback, onStatusChange: QRStatusCallback) {
        this.qrSigningCallback = onQRReady;
        this.qrStatusCallback = onStatusChange;
    }

    /**
     * Clear QR callbacks
     */
    clearQRCallbacks() {
        this.qrSigningCallback = undefined;
        this.qrStatusCallback = undefined;
    }

    isEnabled(): boolean {
        return !!this.wsUrl;
    }

    async checkAndPrepareProvider(): Promise<{ success: boolean; error?: string }> {
        if (!this.wsUrl) {
            return { success: false, error: "QR signing WebSocket URL not configured" };
        }
        return { success: true };
    }

    private sanitizeUsername(raw?: string): string {
        return (raw ?? "").trim().toLowerCase();
    }

    /**
     * Build the message to sign for authentication (EIP-191 format for secp256k1)
     */
    private buildSigningMessage(identity: string, nonce: number): Uint8Array {
        // Message format matches contract: "{identity}:{nonce}:hyliapp"
        const signingMessage = `${identity}:${nonce}:hyliapp`;
        const prefixedMessage = `\x19Ethereum Signed Message:\n${signingMessage.length}${signingMessage}`;
        return keccak256(prefixedMessage);
    }

    /**
     * Derive Ethereum-style address from secp256k1 public key (33 bytes compressed)
     */
    private deriveAddressFromPublicKey(compressedPubKey: Uint8Array): string {
        // Decompress the 33-byte compressed key to 65-byte uncompressed format
        const uncompressedPubKey = decompressPublicKey(compressedPubKey);
        // Skip the 0x04 prefix byte, hash remaining 64 bytes
        const pubKeyWithoutPrefix = uncompressedPubKey.slice(1);
        const hash = keccak256(pubKeyWithoutPrefix);
        // Address is last 20 bytes of the hash
        return encodeToHex(hash.slice(12));
    }

    /**
     * Request a signature via QR code
     */
    private async requestQRSignature(
        messageBytes: Uint8Array,
        description: string,
        timeoutMs: number = 120000
    ): Promise<{ signature: Uint8Array; publicKey: Uint8Array }> {
        if (!this.qrSigningCallback || !this.qrStatusCallback) {
            throw new Error("QR callbacks not set. Call setQRCallbacks before signing.");
        }

        const request = qrSigningService.createSigningRequest(messageBytes, description);
        const qrData = qrSigningService.getQRCodeData(request);

        // Notify UI to display QR code
        this.qrSigningCallback(request, qrData);
        this.qrStatusCallback("waiting");

        try {
            const result = await qrSigningService.requestSignature(request, messageBytes, timeoutMs);
            this.qrStatusCallback("received");
            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Signing failed";
            if (errorMessage.includes("timed out")) {
                this.qrStatusCallback("timeout", errorMessage);
            } else {
                this.qrStatusCallback("error", errorMessage);
            }
            throw error;
        }
    }

    /**
     * Initiate QR connection to get the user's public key/address.
     * This is the first step - user scans QR to identify their device.
     */
    async initiateQRConnection(timeoutMs: number = 120000): Promise<QRConnectionResult> {
        const connectionNonce = Date.now();
        const connectionMessage = `hyli-connect:${connectionNonce}`;
        const prefixedMessage = `\x19Ethereum Signed Message:\n${connectionMessage.length}${connectionMessage}`;
        const messageBytes = keccak256(prefixedMessage);

        const { signature, publicKey } = await this.requestQRSignature(
            messageBytes,
            "Connect to Hyli Wallet"
        );

        const address = this.deriveAddressFromPublicKey(publicKey);

        return { signature, publicKey, address };
    }

    /**
     * Login with a pre-established connection and username.
     * Uses username-based lookup to verify the connected address matches.
     */
    async loginWithUsername(
        connection: QRConnectionResult,
        username: string,
        params: Omit<LoginParams<HyliAppAuthCredentials>, "credentials">
    ): Promise<AuthResult> {
        const { onWalletEvent, onError, registerSessionKey } = params;

        try {
            const sanitizedUsername = this.sanitizeUsername(username);
            if (!sanitizedUsername) {
                return { success: false, error: "Username is required" };
            }

            const indexerService = IndexerService.getInstance();

            // Look up account by username (not address)
            let accountInfo;
            try {
                accountInfo = await indexerService.getAccountInfo(sanitizedUsername);
            } catch (error) {
                return {
                    success: false,
                    code: "ACCOUNT_NOT_FOUND",
                    error: "Account not found. Would you like to create one?"
                };
            }

            if (!("HyliApp" in accountInfo.auth_method)) {
                return { success: false, error: "Account is not registered with Hyli App authentication" };
            }

            // Verify the connected address matches the stored address
            const storedAddress = accountInfo.auth_method.HyliApp.address.toLowerCase().replace("0x", "");
            if (connection.address !== storedAddress) {
                return { success: false, error: "Connected device does not match registered account" };
            }

            const identity = `${sanitizedUsername}@${walletContractName}`;
            const salt = accountInfo.salt;

            let wallet: Wallet = {
                username: sanitizedUsername,
                address: identity,
                salt,
            };

            const sessionKeyPromise = registerSessionKey ? WalletOperations.getOrReuseSessionKey(wallet) : undefined;

            if (registerSessionKey) {
                try {
                    const existingSessionKey = sessionKeyPromise ? await sessionKeyPromise : undefined;
                    if (existingSessionKey) {
                        wallet.sessionKey = existingSessionKey;
                    } else {
                        const nodeService = NodeService.getInstance();
                        const nonce = Date.now();
                        const messageBytes = this.buildSigningMessage(identity, nonce);

                        // Request signature via QR code for session key registration
                        const { signature, publicKey } = await this.requestQRSignature(
                            messageBytes,
                            `Register session key for "${sanitizedUsername}"`,
                        );

                        const secp256k1Blob: Secp256k1Blob = {
                            identity,
                            data: messageBytes,
                            public_key: publicKey,
                            signature: signature,
                        };
                        const secp256k1_blob = {
                            contract_name: "secp256k1",
                            data: serializeSecp256k1Blob(secp256k1Blob),
                        };

                        const wallet_blob = verifyIdentityBlob(sanitizedUsername, nonce);

                        const { duration, whitelist, laneId } = registerSessionKey;
                        const expiration = Date.now() + duration;
                        const generatedSessionKey = sessionKeyService.generateSessionKey(expiration, whitelist);
                        const newSessionKey = laneId
                            ? { ...generatedSessionKey, laneId }
                            : generatedSessionKey;

                        const newPKblob = addSessionKeyBlob(
                            sanitizedUsername,
                            newSessionKey.publicKey,
                            expiration,
                            nonce,
                            whitelist,
                            laneId,
                        );

                        const blobTx: BlobTransaction = {
                            identity,
                            blobs: [wallet_blob, secp256k1_blob, newPKblob],
                        };

                        onWalletEvent?.({ account: identity, type: "sending_blob", message: "Sending blob transaction" });

                        const txHash = await hashBlobTransaction(blobTx);
                        onWalletEvent?.({
                            account: identity,
                            type: "blob_sent",
                            message: `Blob transaction sent: ${txHash}`,
                        });

                        await nodeService.client.sendBlobTx(blobTx);

                        wallet.sessionKey = newSessionKey;
                    }
                } catch (sessionKeyError) {
                    console.error("Failed to register session key via Hyli App:", sessionKeyError);
                    onError?.(
                        sessionKeyError instanceof Error
                            ? sessionKeyError
                            : new Error("Failed to register Hyli App session key"),
                    );
                }
            }

            wallet = WalletOperations.cleanExpiredSessionKeys(wallet);

            onWalletEvent?.({
                account: identity,
                type: "logged_in",
                message: "Login successful",
            });

            return { success: true, wallet };
        } catch (error: any) {
            const err = error instanceof Error ? error : new Error("Hyli App login failed");
            onError?.(err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Register with pre-established connection.
     * After the initial QR connection, user provides username/invite code,
     * then we sign the actual registration message.
     */
    async registerWithConnection(
        connection: QRConnectionResult,
        credentials: HyliAppAuthCredentials,
        params: Omit<RegisterAccountParams<HyliAppAuthCredentials>, "credentials">
    ): Promise<AuthResult> {
        const { onWalletEvent, onError, registerSessionKey } = params;

        try {
            const username = this.sanitizeUsername(credentials.username);
            const inviteCode = credentials.inviteCode ?? "";
            if (!username) {
                return { success: false, error: "Username is required" };
            }
            if (!inviteCode) {
                return { success: false, error: "Invite code is required" };
            }

            const nodeService = NodeService.getInstance();
            const indexerService = IndexerService.getInstance();

            await this.ensureAccountAvailable(username, inviteCode, indexerService, onError);

            const identity = `${username}@${walletContractName}`;
            const nonce = Date.now();

            const messageBytes = this.buildSigningMessage(identity, nonce);

            // Request signature for the registration message
            let signature: Uint8Array;
            let publicKey: Uint8Array;
            try {
                const result = await this.requestQRSignature(
                    messageBytes,
                    `Register account "${username}"`,
                );
                signature = result.signature;
                publicKey = result.publicKey;

                // Verify it's the same key that was connected initially
                const newAddress = this.deriveAddressFromPublicKey(publicKey);
                if (newAddress !== connection.address) {
                    return { success: false, error: "Signature from different device than initial connection" };
                }
            } catch (error: any) {
                return { success: false, error: error.message || "QR signing failed" };
            }

            let inviteCodeBlob;
            try {
                inviteCodeBlob = await indexerService.claimInviteCode(inviteCode, username);
            } catch (error) {
                console.warn("Failed to claim invite code:", error);
                return {
                    success: false,
                    error: "Failed to claim invite code.",
                };
            }

            const secp256k1Blob: Secp256k1Blob = {
                identity,
                data: messageBytes,
                public_key: publicKey,
                signature: signature,
            };
            const secp256k1_blob = {
                contract_name: "secp256k1",
                data: serializeSecp256k1Blob(secp256k1Blob),
            };

            const salt = "";
            const derivedAddress = connection.address;

            const blob_wallet = registerBlob(
                username,
                nonce,
                salt,
                { HyliApp: { address: derivedAddress } },
                inviteCode
            );

            const blobTx: BlobTransaction = {
                identity,
                blobs: [inviteCodeBlob, secp256k1_blob, blob_wallet],
            };

            let newSessionKey;
            if (registerSessionKey) {
                const { duration, whitelist } = registerSessionKey;
                const expiration = Date.now() + duration;
                newSessionKey = sessionKeyService.generateSessionKey(expiration, whitelist);
                blobTx.blobs.push(addSessionKeyBlob(username, newSessionKey.publicKey, expiration, nonce, whitelist));
            }

            onWalletEvent?.({
                account: identity,
                type: "custom",
                message: `Making sure contract is registered`,
            });

            onWalletEvent?.({ account: identity, type: "sending_blob", message: "Sending blob transaction" });

            const txHash = await hashBlobTransaction(blobTx);
            onWalletEvent?.({ account: identity, type: "blob_sent", message: `Blob transaction sent: ${txHash}` });

            await nodeService.client.sendBlobTx(blobTx);

            onWalletEvent?.({ account: identity, type: "sending_proof", message: "Sending proof transaction" });

            let wallet: Wallet = {
                username,
                address: identity,
                salt,
            };

            if (newSessionKey) {
                wallet.sessionKey = newSessionKey;
            }

            const cleanedWallet = WalletOperations.cleanExpiredSessionKeys(wallet);
            return { success: true, wallet: cleanedWallet };
        } catch (error: any) {
            const err = error instanceof Error ? error : new Error("Hyli App registration failed");
            onError?.(err);
            return { success: false, error: err.message };
        }
    }

    private async ensureAccountAvailable(
        username: string,
        inviteCode: string,
        indexerService: IndexerService,
        onError?: WalletErrorCallback
    ) {
        try {
            const accountInfo = await indexerService.getAccountInfo(username);
            if (accountInfo) {
                const error = `Account with username "${username}" already exists.`;
                onError?.(new Error(error));
                throw new Error(error);
            }
        } catch (error: any) {
            // 404 or network error means account doesn't exist - allow registration
            if (error.message?.includes("already exists")) {
                throw error;
            }
            return;
        }

        if (!inviteCode) {
            throw new Error("Invite code is required");
        }
    }

    async login({
        credentials,
        onWalletEvent,
        onError,
        registerSessionKey,
    }: LoginParams<HyliAppAuthCredentials>): Promise<AuthResult> {
        try {
            const username = this.sanitizeUsername(credentials.username);
            if (!username) {
                return { success: false, error: "Username is required" };
            }

            const identity = `${username}@${walletContractName}`;

            const indexerService = IndexerService.getInstance();
            const accountInfo = await indexerService.getAccountInfo(username);

            if (!("HyliApp" in accountInfo.auth_method)) {
                return { success: false, error: "Wallet is not registered with Hyli App authentication" };
            }

            const storedAddress = accountInfo.auth_method.HyliApp.address;

            const nonce = Date.now();
            const messageBytes = this.buildSigningMessage(identity, nonce);

            // Request signature via QR code
            let signature: Uint8Array;
            let publicKey: Uint8Array;
            try {
                const result = await this.requestQRSignature(
                    messageBytes,
                    `Login as "${username}"`,
                );
                signature = result.signature;
                publicKey = result.publicKey;
            } catch (error: any) {
                return { success: false, error: error.message || "QR signing failed" };
            }

            // Verify the derived address matches the stored one
            const derivedAddress = this.deriveAddressFromPublicKey(publicKey);
            const expectedAddress = storedAddress.toLowerCase().replace("0x", "");
            if (derivedAddress !== expectedAddress) {
                return { success: false, error: "Address does not match registered account" };
            }

            const salt = accountInfo.salt;

            let wallet: Wallet = {
                username,
                address: identity,
                salt,
            };

            const sessionKeyPromise = registerSessionKey ? WalletOperations.getOrReuseSessionKey(wallet) : undefined;

            if (registerSessionKey) {
                try {
                    const existingSessionKey = sessionKeyPromise ? await sessionKeyPromise : undefined;
                    if (existingSessionKey) {
                        wallet.sessionKey = existingSessionKey;
                    } else {
                        const nodeService = NodeService.getInstance();

                        const secp256k1Blob: Secp256k1Blob = {
                            identity,
                            data: messageBytes,
                            public_key: publicKey,
                            signature: signature,
                        };
                        const secp256k1_blob = {
                            contract_name: "secp256k1",
                            data: serializeSecp256k1Blob(secp256k1Blob),
                        };

                        const wallet_blob = verifyIdentityBlob(username, nonce);

                        const { duration, whitelist, laneId } = registerSessionKey;
                        const expiration = Date.now() + duration;
                        const generatedSessionKey = sessionKeyService.generateSessionKey(expiration, whitelist);
                        const newSessionKey = laneId
                            ? { ...generatedSessionKey, laneId }
                            : generatedSessionKey;

                        const newPKblob = addSessionKeyBlob(
                            username,
                            newSessionKey.publicKey,
                            expiration,
                            nonce,
                            whitelist,
                            laneId,
                        );

                        const blobTx: BlobTransaction = {
                            identity,
                            // secp256k1_blob needs to be at index 1
                            blobs: [wallet_blob, secp256k1_blob, newPKblob],
                        };

                        onWalletEvent?.({ account: identity, type: "sending_blob", message: "Sending blob transaction" });

                        const txHash = await hashBlobTransaction(blobTx);
                        onWalletEvent?.({
                            account: identity,
                            type: "blob_sent",
                            message: `Blob transaction sent: ${txHash}`,
                        });

                        await nodeService.client.sendBlobTx(blobTx);

                        wallet.sessionKey = newSessionKey;
                    }
                } catch (sessionKeyError) {
                    console.error("Failed to register session key via Hyli App:", sessionKeyError);
                    onError?.(
                        sessionKeyError instanceof Error
                            ? sessionKeyError
                            : new Error("Failed to register Hyli App session key"),
                    );
                }
            }

            wallet = WalletOperations.cleanExpiredSessionKeys(wallet);

            onWalletEvent?.({
                account: identity,
                type: "logged_in",
                message: "Login successful",
            });

            return { success: true, wallet };
        } catch (error: any) {
            const err = error instanceof Error ? error : new Error("Hyli App login failed");
            onError?.(err);
            return { success: false, error: err.message };
        }
    }

    async register({
        credentials,
        onWalletEvent,
        onError,
        registerSessionKey,
    }: RegisterAccountParams<HyliAppAuthCredentials>): Promise<AuthResult> {
        try {
            const username = this.sanitizeUsername(credentials.username);
            const inviteCode = credentials.inviteCode ?? "";
            if (!username) {
                return { success: false, error: "Username is required" };
            }
            if (!inviteCode) {
                return { success: false, error: "Invite code is required" };
            }

            const nodeService = NodeService.getInstance();
            const indexerService = IndexerService.getInstance();

            await this.ensureAccountAvailable(username, inviteCode, indexerService, onError);

            const identity = `${username}@${walletContractName}`;
            const nonce = Date.now();

            const messageBytes = this.buildSigningMessage(identity, nonce);

            // Request signature via QR code
            let signature: Uint8Array;
            let publicKey: Uint8Array;
            try {
                const result = await this.requestQRSignature(
                    messageBytes,
                    `Register account "${username}"`,
                );
                signature = result.signature;
                publicKey = result.publicKey;
            } catch (error: any) {
                return { success: false, error: error.message || "QR signing failed" };
            }

            let inviteCodeBlob;
            try {
                inviteCodeBlob = await indexerService.claimInviteCode(inviteCode, username);
            } catch (error) {
                console.warn("Failed to claim invite code:", error);
                return {
                    success: false,
                    error: "Failed to claim invite code.",
                };
            }

            const secp256k1Blob: Secp256k1Blob = {
                identity,
                data: messageBytes,
                public_key: publicKey,
                signature: signature,
            };
            const secp256k1_blob = {
                contract_name: "secp256k1",
                data: serializeSecp256k1Blob(secp256k1Blob),
            };

            const salt = "";
            const derivedAddress = this.deriveAddressFromPublicKey(publicKey);

            const blob_wallet = registerBlob(
                username,
                nonce,
                salt,
                { HyliApp: { address: derivedAddress } },
                inviteCode
            );

            const blobTx: BlobTransaction = {
                identity,
                blobs: [inviteCodeBlob, secp256k1_blob, blob_wallet],
            };

            let newSessionKey;
            if (registerSessionKey) {
                const { duration, whitelist } = registerSessionKey;
                const expiration = Date.now() + duration;
                newSessionKey = sessionKeyService.generateSessionKey(expiration, whitelist);
                blobTx.blobs.push(addSessionKeyBlob(username, newSessionKey.publicKey, expiration, nonce, whitelist));
            }

            onWalletEvent?.({
                account: identity,
                type: "custom",
                message: `Making sure contract is registered`,
            });

            onWalletEvent?.({ account: identity, type: "sending_blob", message: "Sending blob transaction" });

            const txHash = await hashBlobTransaction(blobTx);
            onWalletEvent?.({ account: identity, type: "blob_sent", message: `Blob transaction sent: ${txHash}` });

            await nodeService.client.sendBlobTx(blobTx);

            onWalletEvent?.({ account: identity, type: "sending_proof", message: "Sending proof transaction" });

            let wallet: Wallet = {
                username,
                address: identity,
                salt,
            };

            if (newSessionKey) {
                wallet.sessionKey = newSessionKey;
            }

            const cleanedWallet = WalletOperations.cleanExpiredSessionKeys(wallet);
            return { success: true, wallet: cleanedWallet };
        } catch (error: any) {
            const err = error instanceof Error ? error : new Error("Hyli App registration failed");
            onError?.(err);
            return { success: false, error: err.message };
        }
    }
}
