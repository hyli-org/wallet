// GoogleAuthProvider.ts
// Use Web Crypto API in browser instead of Node 'crypto'
import { AuthProvider, AuthResult, RegisterAccountParams, LoginParams } from "./BaseAuthProvider";
import {
    Wallet,
    SessionKey,
    registerBlob,
    verifyIdentityBlob,
    addSessionKeyBlob, // <- version corrigée ci-dessus
    WalletEventCallback,
    walletContractName,
} from "../types/wallet"; // ajuste le chemin si besoin

import { BlobTransaction, Blob as HyliBlob } from "hyli"; // ajuste le chemin si besoin
import { NodeService } from "../services/NodeService";
import { IndexerService } from "../services/IndexerService";
import { registerSessionKey } from "../services/WalletOperations";
import { sessionKeyService } from "../services/SessionKeyService";
import { hashBlobTransaction } from "../utils/hash";

import * as WalletOperations from "../services/WalletOperations";

export interface GoogleAuthCredentials {
    username: string; // requis par AuthCredentials
    googleToken: string; // ID token Google
    inviteCode?: string; // requis en register()
}

export class GoogleAuthProvider implements AuthProvider<GoogleAuthCredentials> {
    type = "google";
    private clientIdStr: string;

    constructor(private clientId: string) {
        this.clientIdStr = clientId;
    }

    isEnabled(): boolean {
        return Boolean(this.clientId);
    }

    // ---------- Google token ----------
    private async verifyGoogleIdToken(idToken: string) {
        // Browser-friendly validation using Google's tokeninfo endpoint
        const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
        if (!res.ok) throw new Error("Failed to verify Google token");
        const payload = (await res.json()) as any;
        if (!payload || !payload.sub || !payload.email) {
            throw new Error("Invalid Google token payload");
        }
        if (this.clientIdStr && payload.aud && payload.aud !== this.clientIdStr) {
            throw new Error("Google token audience mismatch");
        }
        try {
            console.log("[Hyli][Google] Token verified", {
                aud: payload.aud,
                sub: payload.sub,
                email: payload.email,
                iss: payload.iss,
                email_verified: payload.email_verified,
                name: payload.name,
            });
        } catch {}
        return {
            sub: payload.sub as string,
            email: payload.email as string,
            name: (payload.name as string) ?? "",
            picture: (payload.picture as string) ?? "",
            emailVerified: Boolean(payload.email_verified ?? payload.email_verified === "true"),
        };
    }

    // ---------- Helpers ----------
    private toHex(bytes: Uint8Array): string {
        return Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
    }

    private async sha256Hex(input: Uint8Array | string): Promise<string> {
        const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
        const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
        return this.toHex(new Uint8Array(digest));
    }

    private async newSessionKey(durationMs: number, wl?: string[], laneId?: string): Promise<SessionKey> {
        const priv = new Uint8Array(32);
        globalThis.crypto.getRandomValues(priv);
        const pubHex = await this.sha256Hex(priv);
        return {
            privateKey: this.toHex(priv),
            publicKey: pubHex,
            expiration: Date.now() + durationMs,
            whitelist: wl,
            laneId,
        };
    }

    // Adaptateur: publie un évènement WalletEvent (pas un TransactionCallback)
    private notifyTxAsWalletEvent(
        onWalletEvent: WalletEventCallback | undefined,
        account: string,
        txHash: string,
        txType: string,
    ) {
        onWalletEvent?.({
            account,
            type: "custom",
            message: `${txType}:${txHash}`,
        });
    }

    private async addSessionKeyOnChain(account: string, sessionKey: SessionKey, onWalletEvent?: WalletEventCallback) {
        const nonce = await IndexerService.getInstance()
            .getAccountInfo(account)
            .then((info) => info.nonce + 1)
            .catch(() => 1);
        const blob = addSessionKeyBlob(
            account,
            sessionKey.publicKey,
            sessionKey.expiration,
            nonce,
            sessionKey.whitelist,
            sessionKey.laneId,
            //{},
        );
        const txHash = await this.deps.submitBlob(account, blob);
        // On émet un WalletEvent (pas un TransactionCallback)
        this.notifyTxAsWalletEvent(onWalletEvent, account, txHash, "AddSessionKey");
    }

    // ---------- AuthProvider API ----------
    async login(params: LoginParams<GoogleAuthCredentials>): Promise<AuthResult> {
        const { credentials, onWalletEvent, onError, registerSessionKey } = params;
        try {
            if (!credentials?.googleToken) {
                return { success: false, error: "Google token is required" };
            }

            const g = await this.verifyGoogleIdToken(credentials.googleToken);
            const username = (g.email as string).toLowerCase();
            const account = `${username}@${walletContractName}`;

            console.log("[Hyli][Google] Login flow", {
                username,
                sub: g.sub,
                email: g.email,
                account,
            });

            onWalletEvent?.({ account, type: "checking_password", message: "Verifying Google identity…" });

            const wallet: Wallet = { username, address: account, salt: "" };

            if (registerSessionKey?.duration) {
                const sk = await this.newSessionKey(
                    registerSessionKey.duration,
                    registerSessionKey.whitelist,
                    registerSessionKey.laneId,
                );
                await this.addSessionKeyOnChain(account, sk, onWalletEvent);
                wallet.sessionKey = sk;
            }

            onWalletEvent?.({ account, type: "logged_in", message: "Login successful" });
            return { success: true, wallet };
        } catch (e: any) {
            onError?.(e);
            return { success: false, error: e?.message ?? "Google login failed" };
        }
    }

    async register(params: RegisterAccountParams<GoogleAuthCredentials>): Promise<AuthResult> {
        const nodeService = NodeService.getInstance();
        const { onError, registerSessionKey, onWalletEvent } = params;
        try {
            const { username, inviteCode } = params.credentials;

            console.log("[Hyli][Google] Register flow CALLLLLL", { username, inviteCode });

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

            const blob1 = registerBlob(username, Date.now(), "", { Jwt: {} }, inviteCode);

            const blobTx: BlobTransaction = {
                identity,
                blobs: [blob1, inviteCodeBlob],
            };

            let newSessionKey;
            if (registerSessionKey) {
                const { duration, whitelist } = registerSessionKey;
                const expiration = Date.now() + duration; // still in milliseconds
                newSessionKey = sessionKeyService.generateSessionKey(expiration, whitelist);
                blobTx.blobs.push(
                    addSessionKeyBlob(username, newSessionKey.publicKey, expiration, Date.now(), whitelist),
                );
            }

            onWalletEvent?.({ account: identity, type: "sending_blob", message: `Sending blob transaction` });
            // Skipped, to make sure we send the proof alongside.
            const txHash = await hashBlobTransaction(blobTx);
            //const txHash = await nodeService.client.sendBlobTx(blobTx);
            onWalletEvent?.({ account: identity, type: "blob_sent", message: `Blob transaction sent: ${txHash}` });

            // Create initial wallet state
            const wallet: Wallet = {
                username,
                address: identity,
                salt: "",
            };

            onWalletEvent?.({ account: identity, type: "custom", message: `Generating proof of password` });

            await nodeService.client.sendBlobTx(blobTx);

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
