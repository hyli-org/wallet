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
import { encodeToHex, hashBlobTransaction, hexToBytes } from "../utils/hash";
import { AuthCredentials, AuthResult } from "../types/auth";
import EC from "elliptic";
import { keccak_256 } from "js-sha3";
import {
    findEthereumProviderByUuid,
    getEthereumProviders,
    initializeEthereumProviders,
} from "./ethereumProviders";
import { EIP1193Provider } from "mipd";

export interface EthereumWalletAuthCredentials extends AuthCredentials {
    inviteCode?: string;
    providerId?: string; // ID du provider EIP-6963 utilisé
}

export interface EthereumWalletAuthProviderOptions {
    /**
     * Optional prefix for the Ethereum wallet signing message.
     * The username will be appended to this value when requesting a signature.
     */
    messagePrefix?: string;
}

const DEFAULT_SIGNING_PREFIX = "Sign in to Hyli as";
const secp256k1 = new EC.ec("secp256k1");

export class EthereumWalletAuthProvider implements AuthProvider<EthereumWalletAuthCredentials> {
    readonly type = "ethereum";
    private messagePrefix: string;

    constructor(options?: EthereumWalletAuthProviderOptions) {
        this.messagePrefix = options?.messagePrefix ?? DEFAULT_SIGNING_PREFIX;
        initializeEthereumProviders();
    }

    isEnabled(): boolean {
        if (typeof window === "undefined") {
            return false;
        }
        const providers = getEthereumProviders();
        return providers.length > 0;
    }

    /**
     * Checks if Ethereum wallets are available and unlocked. If locked, prompts user to unlock.
     * Should be called when the user selects an Ethereum wallet as their provider.
     */
    async checkAndPrepareEthereumWallet(providerId?: string): Promise<{ success: boolean; error?: string }> {
        try {
            if (!this.isEnabled()) {
                return { success: false, error: "No Ethereum wallets are installed or available" };
            }

            const providers = getEthereumProviders();
            if (providers.length === 0) {
                return { success: false, error: "No Ethereum wallets detected" };
            }

            // Use specific provider if provided, otherwise first available
            let targetProvider;
            if (providerId) {
                targetProvider = providers.find(p => p.info.uuid === providerId);
                if (!targetProvider) {
                    return { success: false, error: `Ethereum wallet with ID ${providerId} not found` };
                }
            } else {
                targetProvider = providers[0];
            }

            const ethereum = targetProvider.provider;
            
            // Check if wallet is unlocked
            await this.ensureWalletIsUnlocked(ethereum);
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message || "Failed to prepare Ethereum wallet" };
        }
    }

    /**
     * Implementation of the optional checkAndPrepareProvider method
     */
    async checkAndPrepareProvider(): Promise<{ success: boolean; error?: string }> {
        return this.checkAndPrepareEthereumWallet();
    }

    private getEthereum(providerId?: string): any {
        const providers = getEthereumProviders();

        if (providers.length === 0) {
            throw new Error("No Ethereum wallets detected");
        }

        // Si un providerId spécifique est demandé
        if (providerId) {
            const specificProvider = findEthereumProviderByUuid(providerId);
            if (!specificProvider) {
                throw new Error(`Ethereum wallet with ID ${providerId} not found`);
            }
            return specificProvider.provider;
        }

        // Sinon, utiliser le premier provider disponible
        return providers[0].provider;
    }

    private async getPrimaryAccount(ethereum: EIP1193Provider): Promise<string[]> {
        const accounts = await ethereum.request({
            method: "eth_requestAccounts",
        });
        console.log("primary accounts: ", accounts);
        if (!accounts || accounts.length === 0) {
            throw new Error("No wallet account connected");
        }
        return accounts;
    }

    private async ensureWalletIsUnlocked(ethereum: EIP1193Provider) {
        await ethereum.request({
          method: "wallet_requestPermissions",
          params: [{ eth_accounts: {} }],
        });
    }

    private buildSigningMessage(username: string, nonce: number): string {
        return `${this.messagePrefix} ${username} with nonce ${nonce}`;
    }

    private buildEthereumSignedMessage(message: string): string {
        const encoder = new TextEncoder();
        const messageBytes = encoder.encode(message);
        return `\x19Ethereum Signed Message:\n${messageBytes.length}${message}`;
    }

    private buildEthereumMessageDigest(message: string): Uint8Array {
        const signedMessage = this.buildEthereumSignedMessage(message);
        return new Uint8Array(keccak_256.arrayBuffer(signedMessage));
    }

    private async signWithEthereumWallet(message: string, providerId?: string): Promise<{ ethAddr: string[]; signature: string }> {
        const ethereum = this.getEthereum(providerId);
        const ethAddr = await this.getPrimaryAccount(ethereum);
        const signature = await ethereum.request({
            method: "personal_sign",
            params: [message, ethAddr[0]],
        });
        if (!signature) {
            throw new Error("Ethereum wallet signature failed");
        }
        return { ethAddr, signature };
    }

    private sanitizeUsername(raw?: string): string {
        return (raw ?? "").trim().toLowerCase();
    }

    private decodeSignature(signatureHex: string): { r: Uint8Array; s: Uint8Array; recovery: number } {
        const raw = signatureHex.startsWith("0x") ? signatureHex.slice(2) : signatureHex;
        const signatureBytes = hexToBytes(raw);
        if (signatureBytes.length !== 65) {
            throw new Error("Invalid MetaMask signature length");
        }
        const r = signatureBytes.slice(0, 32);
        const s = signatureBytes.slice(32, 64);
        const recoveryByte = signatureBytes[64];
        const recovery = recoveryByte >= 27 ? recoveryByte - 27 : recoveryByte;
        if (recovery !== 0 && recovery !== 1) {
            throw new Error("Unsupported MetaMask recovery id");
        }
        return { r, s, recovery };
    }

    private deriveEthereumAddress(uncompressedPublicKey: Uint8Array): string {
        if (uncompressedPublicKey.length !== 65 || uncompressedPublicKey[0] !== 0x04) {
            throw new Error("Invalid uncompressed public key");
        }
        const hashHex = keccak_256(uncompressedPublicKey.slice(1));
        return `0x${hashHex.slice(-40)}`;
    }

    private normalizeEthereumAddress(address: string): string {
        const trimmed = address.trim();
        if (!trimmed) {
            throw new Error("Missing Ethereum address");
        }
        const lower = trimmed.toLowerCase();
        const prefixed = lower.startsWith("0x") ? lower : `0x${lower}`;
        if (prefixed.length !== 42) {
            throw new Error("Invalid Ethereum address length");
        }
        return prefixed;
    }

    private buildSecp256k1SignatureComponents(digest: Uint8Array, signatureHex: string): {
        publicKey: Uint8Array;
        compactSignature: Uint8Array;
        address: string;
    } {
        const { r, s, recovery } = this.decodeSignature(signatureHex);
        const signature = { r: encodeToHex(r), s: encodeToHex(s) };

        const publicKeyPoint = secp256k1.recoverPubKey(digest, signature, recovery);
        const compressedPublicKey = new Uint8Array(publicKeyPoint.encodeCompressed());
        if (compressedPublicKey.length !== 33) {
            throw new Error("Invalid recovered public key length");
        }

        const uncompressedPublicKey = new Uint8Array(publicKeyPoint.encode("array", false));
        const derivedAddress = this.normalizeEthereumAddress(this.deriveEthereumAddress(uncompressedPublicKey));

        const compactSignature = new Uint8Array([...r, ...s]);

        return {
            publicKey: compressedPublicKey,
            compactSignature,
            address: derivedAddress,
        };
    }

    private async ensureAccountAvailable(
        username: string,
        inviteCode: string,
        indexerService: IndexerService,
        onError?: WalletErrorCallback
    ) {
        const identity = `${username}@${walletContractName}`;
        try {
            const accountInfo = await indexerService.getAccountInfo(identity);
            if (accountInfo) {
                const error = `Account with username "${username}" already exists.`;
                onError?.(new Error(error));
                throw new Error(error);
            }
        } catch (error: any) {
            // Any failure from the indexer means the account is not registered yet.
            // We ignore 404 and network errors to allow registration to proceed.
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
    }: LoginParams<EthereumWalletAuthCredentials>): Promise<AuthResult> {
        try {
            const username = this.sanitizeUsername(credentials.username);
            if (!username) {
                return { success: false, error: "Username is required" };
            }

            const identity = `${username}@${walletContractName}`;

            onWalletEvent?.({
                account: identity,
                type: "checking_password",
                message: "Requesting Ethereum wallet signature…",
            });

            const indexerService = IndexerService.getInstance();
            const accountInfo = await indexerService.getAccountInfo(username);
            if (!("Ethereum" in accountInfo.auth_method)) {
                return { success: false, error: "Wallet is not registered with Ethereum authentication" };
            }

            const storedAddress = this.normalizeEthereumAddress(
                `${accountInfo.auth_method.Ethereum.address ?? ""}`,
            );
            const nonce = Date.now();
            const message = this.buildSigningMessage(identity, nonce);
            
            let ethAddr: string[];
            let signature: string;
            try {
                const result = await this.signWithEthereumWallet(message, credentials.providerId);
                ethAddr = result.ethAddr;
                signature = result.signature;
            } catch (error: any) {
                // Handle wallet specific errors
                if (error.code === 4001) {
                    return { success: false, error: "Wallet signature request was rejected by user" };
                }
                if (error.message.includes("User rejected") || error.message.includes("User denied")) {
                    return { success: false, error: "Wallet signature request was rejected by user" };
                }
                throw error; // Re-throw other errors
            }
            
            const walletAddress = this.normalizeEthereumAddress(ethAddr[0]);

            if (walletAddress !== storedAddress) {
                return { success: false, error: "Ethereum account does not match registered wallet address" };
            }

            const digest = this.buildEthereumMessageDigest(message);
            const { publicKey, compactSignature, address: recoveredAddress } = this.buildSecp256k1SignatureComponents(digest, signature);

            if (recoveredAddress !== walletAddress) {
                return { success: false, error: "Recovered address does not match wallet account" };
            }

            const salt = accountInfo.salt;

            // Store Ethereum provider information
            let ethereumProviderUuid: string | undefined;
            if (credentials.providerId) {
                    ethereumProviderUuid = credentials.providerId;
            }

            let wallet: Wallet = {
                username,
                address: identity,
                salt,
                ethereumProviderUuid,
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
                            data: digest,
                            public_key: publicKey,
                            signature: compactSignature,
                        };
                        const secp_blob = {
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
                            // warning: secp_blob need to be at index 1
                            blobs: [wallet_blob, secp_blob, newPKblob],
                        };

                        onWalletEvent?.({ account: identity, type: "sending_blob", message: "Sending blob transaction" });

                        const txHash = await hashBlobTransaction(blobTx);
                        onWalletEvent?.({
                            account: identity,
                            type: "blob_sent",
                            message: `Blob transaction sent: ${txHash}`,
                        });

                        await nodeService.client.sendBlobTx(blobTx);

                        // TODO(?): Assert transaction settles to assure the session key is valid (?)
                        wallet.sessionKey = newSessionKey;
                    }
                } catch (sessionKeyError) {
                    console.error("Failed to register session key via Ethereum wallet:", sessionKeyError);
                    onError?.(
                        sessionKeyError instanceof Error
                            ? sessionKeyError
                            : new Error("Failed to register Ethereum wallet session key"),
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
            const err = error instanceof Error ? error : new Error("Ethereum wallet login failed");
            onError?.(err);
            return { success: false, error: err.message };
        }
    }

    async register({
        credentials,
        onWalletEvent,
        onError,
        registerSessionKey,
    }: RegisterAccountParams<EthereumWalletAuthCredentials>): Promise<AuthResult> {
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
            
            const message = this.buildSigningMessage(identity, nonce);
            let ethAddr: string[];
            let signature: string;
            try {
                const result = await this.signWithEthereumWallet(message, credentials.providerId);
                ethAddr = result.ethAddr;
                signature = result.signature;
            } catch (error: any) {
                // Handle wallet specific errors
                if (error.code === 4001) {
                    return { success: false, error: "Wallet signature request was rejected by user" };
                }
                if (error.message.includes("User rejected") || error.message.includes("User denied")) {
                    return { success: false, error: "Wallet signature request was rejected by user" };
                }
                throw error; // Re-throw other errors
            }
            
            const walletAddress = this.normalizeEthereumAddress(ethAddr[0]);

            const digest = this.buildEthereumMessageDigest(message);
            const { publicKey, compactSignature, address: recoveredAddress } =
                this.buildSecp256k1SignatureComponents(digest, signature);

            if (recoveredAddress !== walletAddress) {
                throw new Error("Recovered public key does not match wallet address");
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
                data: digest,
                public_key: publicKey,
                signature: compactSignature,
            };
            const secp_blob = {
                contract_name: "secp256k1",
                data: serializeSecp256k1Blob(secp256k1Blob),
            };

            let salt = "";

            const blob_wallet = registerBlob(
                username,
                nonce,
                salt,
                { Ethereum: { address: walletAddress } },
                inviteCode
            );

            const blobTx: BlobTransaction = {
                identity,
                blobs: [inviteCodeBlob, secp_blob, blob_wallet],
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
            
            // TODO: change this event
            onWalletEvent?.({ account: identity, type: "sending_proof", message: "Sending proof transaction" });

            // Store Ethereum provider information
            let ethereumProviderUuid: string | undefined;
            if (credentials.providerId) {
                    ethereumProviderUuid = credentials.providerId;
            }

            let wallet: Wallet = {
                username,
                address: identity,
                salt,
                ethereumProviderUuid,
            };

            if (newSessionKey) {
                wallet.sessionKey = newSessionKey;
            }

            const cleanedWallet = WalletOperations.cleanExpiredSessionKeys(wallet);
            return { success: true, wallet: cleanedWallet };
        } catch (error: any) {
            const err = error instanceof Error ? error : new Error("Ethereum wallet registration failed");
            onError?.(err);
            return { success: false, error: err.message };
        }
    }
}
