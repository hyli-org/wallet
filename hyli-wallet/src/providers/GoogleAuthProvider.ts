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
} from "../types/wallet"; // ajuste le chemin si besoin

import { Blob as HyliBlob } from "hyli"; // ajuste le chemin si besoin

export interface GoogleAuthCredentials {
    username: string; // requis par AuthCredentials
    googleToken: string; // ID token Google
    inviteCode?: string; // requis en register()
}

// Dépendances d’infra
type SubmitBlob = (blob: HyliBlob) => Promise<string>; // retourne txHash

export interface GoogleAuthProviderDeps {
    submitBlob: SubmitBlob;
    getNonce(account: string): Promise<number>;
    resolveAccountAddress(username: string, googleSub: string): Promise<string>;
}

export class GoogleAuthProvider implements AuthProvider<GoogleAuthCredentials> {
    type = "google";
    private clientIdStr: string;

    constructor(
        private clientId: string,
        private deps: GoogleAuthProviderDeps,
    ) {
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

    private randomSalt(bytes = 16): string {
        const arr = new Uint8Array(bytes);
        globalThis.crypto.getRandomValues(arr);
        return this.toHex(arr);
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
        const blob = addSessionKeyBlob(
            account,
            sessionKey.publicKey,
            sessionKey.expiration,
            sessionKey.whitelist,
            sessionKey.laneId,
        );
        const txHash = await this.deps.submitBlob(blob);
        // On émet un WalletEvent (pas un TransactionCallback)
        this.notifyTxAsWalletEvent(onWalletEvent, account, txHash, "AddSessionKey");
    }

    private async registerIfNeeded(
        account: string,
        salt: string,
        inviteCode: string,
        onWalletEvent?: WalletEventCallback,
    ) {
        const nonce = await this.deps.getNonce(account);

        const passwordHash = await this.sha256Hex(`${account}:${salt}`);

        // RegisterIdentity
        const regBlob = registerBlob(account, nonce, salt, passwordHash, inviteCode);
        const regTx = await this.deps.submitBlob(regBlob);
        this.notifyTxAsWalletEvent(onWalletEvent, account, regTx, "RegisterIdentity");

        // VerifyIdentity (optionnel selon ton protocole)
        const verBlob = verifyIdentityBlob(account, nonce + 1);
        const verTx = await this.deps.submitBlob(verBlob);
        this.notifyTxAsWalletEvent(onWalletEvent, account, verTx, "VerifyIdentity");
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
            const account = await this.deps.resolveAccountAddress(username, g.sub);
            try {
                console.log("[Hyli][Google] Login flow", {
                    username,
                    sub: g.sub,
                    email: g.email,
                    account,
                });
            } catch {}

            onWalletEvent?.({ account, type: "checking_password", message: "Verifying Google identity…" });

            const salt = this.randomSalt();
            const wallet: Wallet = { username, address: account, salt };

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
        const { credentials, onWalletEvent, onError, registerSessionKey } = params;
        try {
            if (!credentials?.googleToken) {
                return { success: false, error: "Google token is required" };
            }
            if (!credentials.inviteCode) {
                return { success: false, error: "Invite code is required" };
            }

            const g = await this.verifyGoogleIdToken(credentials.googleToken);
            const username = (g.email as string).toLowerCase();
            const account = await this.deps.resolveAccountAddress(username, g.sub);
            try {
                console.log("[Hyli][Google] Register flow", {
                    username,
                    sub: g.sub,
                    email: g.email,
                    account,
                });
            } catch {}
            const salt = this.randomSalt();

            onWalletEvent?.({ account, type: "sending_blob", message: "Registering identity…" });
            await this.registerIfNeeded(account, salt, credentials.inviteCode, onWalletEvent);
            onWalletEvent?.({ account, type: "blob_sent", message: "Identity registered" });

            const wallet: Wallet = { username, address: account, salt };

            if (registerSessionKey?.duration) {
                onWalletEvent?.({ account, type: "sending_proof", message: "Adding session key…" });
                const sk = await this.newSessionKey(
                    registerSessionKey.duration,
                    registerSessionKey.whitelist,
                );
                await this.addSessionKeyOnChain(account, sk, onWalletEvent);
                wallet.sessionKey = sk;
                onWalletEvent?.({ account, type: "proof_sent", message: "Session key added" });
            }

            onWalletEvent?.({ account, type: "logged_in", message: "Registration complete" });
            return { success: true, wallet };
        } catch (e: any) {
            onError?.(e);
            return { success: false, error: e?.message ?? "Google registration failed" };
        }
    }
}
