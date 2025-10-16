import { AuthProvider, LoginParams, RegisterAccountParams } from "./BaseAuthProvider";
import {
    Wallet,
    addSessionKeyBlob,
    registerBlob,
    walletContractName,
    WalletErrorCallback,
    WalletEventCallback,
    Secp256k1Blob,
    serializeSecp256k1Blob,
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

export interface MetamaskAuthCredentials extends AuthCredentials {
    inviteCode?: string;
}

export interface MetamaskAuthProviderOptions {
    /**
     * Optional prefix for the MetaMask signing message.
     * The username will be appended to this value when requesting a signature.
     */
    messagePrefix?: string;
}

type EthereumProvider = {
    request<T = unknown>(args: { method: string; params?: unknown[] }): Promise<T>;
    isMetaMask?: boolean;
};

const DEFAULT_SIGNING_PREFIX = "Sign in to Hyli as";
const secp256k1 = new EC.ec("secp256k1");

export class MetamaskAuthProvider implements AuthProvider<MetamaskAuthCredentials> {
    readonly type = "metamask";
    private messagePrefix: string;

    constructor(options?: MetamaskAuthProviderOptions) {
        this.messagePrefix = options?.messagePrefix ?? DEFAULT_SIGNING_PREFIX;
    }

    isEnabled(): boolean {
        if (typeof window === "undefined") {
            return false;
        }
        const eth = (window as any).ethereum as EthereumProvider | undefined;
        return Boolean(eth?.isMetaMask);
    }

    private getEthereum(): EthereumProvider {
        if (typeof window === "undefined") {
            throw new Error("MetaMask is only available in the browser");
        }
        const eth = (window as any).ethereum as EthereumProvider | undefined;
        if (!eth) {
            throw new Error("MetaMask provider not found");
        }
        return eth;
    }

    private async getPrimaryAccount(ethereum: EthereumProvider): Promise<string[]> {
        const accounts = (await ethereum.request<string[]>({
            method: "eth_requestAccounts",
        })) as string[];
        if (!accounts || accounts.length === 0) {
            throw new Error("No MetaMask account connected");
        }
        return accounts;
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

    private async signWithMetamask(message: string): Promise<{ ethAddr: string[]; signature: string }> {
        const ethereum = this.getEthereum();
        const ethAddr = await this.getPrimaryAccount(ethereum);
        const signature = (await ethereum.request<string>({
            method: "personal_sign",
            params: [message, ethAddr[0]],
        })) as string;
        if (!signature) {
            throw new Error("MetaMask digest signature failed");
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
        registerSessionKey: _registerSessionKey,
    }: LoginParams<MetamaskAuthCredentials>): Promise<AuthResult> {
        try {
            const username = this.sanitizeUsername(credentials.username);
            if (!username) {
                return { success: false, error: "Username is required" };
            }

            const identity = `${username}@${walletContractName}`;

            onWalletEvent?.({
                account: identity,
                type: "checking_password",
                message: "Requesting MetaMask signature…",
            });

            const indexerService = IndexerService.getInstance();
            const accountInfo = await indexerService.getAccountInfo(username);
            if (!("Ethereum" in accountInfo.auth_method)) {
                return { success: false, error: "Wallet is not registered with MetaMask authentication" };
            }

            const storedAddress = this.normalizeEthereumAddress(
                `${accountInfo.auth_method.Ethereum.address ?? ""}`,
            );
            const nonce = accountInfo.nonce ?? 0;
            const message = this.buildSigningMessage(identity, nonce);
            const { ethAddr, signature } = await this.signWithMetamask(message);
            const walletAddress = this.normalizeEthereumAddress(ethAddr[0]);

            if (walletAddress !== storedAddress) {
                return { success: false, error: "Ethereum account does not match registered wallet address" };
            }

            const digest = this.buildEthereumMessageDigest(message);
            const { address: recoveredAddress } = this.buildSecp256k1SignatureComponents(digest, signature);

            if (recoveredAddress !== walletAddress) {
                return { success: false, error: "Recovered address does not match MetaMask account" };
            }

            const salt = accountInfo.salt;

            let wallet: Wallet = {
                username,
                address: identity,
                salt,
            };

            onWalletEvent?.({
                account: identity,
                type: "logged_in",
                message: "Login successful",
            });

            return { success: true, wallet };
        } catch (error: any) {
            const err = error instanceof Error ? error : new Error("MetaMask login failed");
            onError?.(err);
            return { success: false, error: err.message };
        }
    }

    async register({
        credentials,
        onWalletEvent,
        onError,
        registerSessionKey,
    }: RegisterAccountParams<MetamaskAuthCredentials>): Promise<AuthResult> {
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
            console.log("Signing message:", message);
            const { ethAddr, signature } = await this.signWithMetamask(message);
            const walletAddress = this.normalizeEthereumAddress(ethAddr[0]);

            const digest = this.buildEthereumMessageDigest(message);
            const { publicKey, compactSignature, address: recoveredAddress } =
                this.buildSecp256k1SignatureComponents(digest, signature);

            if (recoveredAddress !== walletAddress) {
                throw new Error("Recovered public key does not match MetaMask address");
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
                blobTx.blobs.push(addSessionKeyBlob(username, newSessionKey.publicKey, expiration, whitelist));
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
            const err = error instanceof Error ? error : new Error("MetaMask registration failed");
            onError?.(err);
            return { success: false, error: err.message };
        }
    }
}
