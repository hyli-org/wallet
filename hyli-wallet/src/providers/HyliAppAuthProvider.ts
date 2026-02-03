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
import { keccak256 } from "../utils/keccak";
import { decompressPublicKey } from "../utils/secp256k1";

export interface HyliAppAuthCredentials extends AuthCredentials {
    inviteCode?: string;
}

export class HyliAppAuthProvider implements AuthProvider<HyliAppAuthCredentials> {
    readonly type = "hyliapp";

    constructor() {}

    isEnabled(): boolean {
        return false;
    }

    async checkAndPrepareProvider(): Promise<{ success: boolean; error?: string }> {
        return { success: false, error: "HyliApp authentication is not available" };
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
        return { success: false, error: "HyliApp authentication is not available" };
    }

    async register({
        credentials,
        onWalletEvent,
        onError,
        registerSessionKey,
    }: RegisterAccountParams<HyliAppAuthCredentials>): Promise<AuthResult> {
        return { success: false, error: "HyliApp authentication is not available" };
    }
}
