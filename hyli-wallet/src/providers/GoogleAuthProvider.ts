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
    JsonWebToken,
    build_check_jwt_blob,
} from "../types/wallet"; // ajuste le chemin si besoin

import { BlobTransaction, Blob as HyliBlob, ProofTransaction } from "hyli"; // ajuste le chemin si besoin
import { NodeService } from "../services/NodeService";
import { IndexerService } from "../services/IndexerService";
import { registerSessionKey } from "../services/WalletOperations";
import { sessionKeyService } from "../services/SessionKeyService";
import { hashBlobTransaction } from "../utils/hash";

import * as WalletOperations from "../services/WalletOperations";
import { Barretenberg, Fr } from "@aztec/bb.js";
import { bytesToBigInt, extractClaimsFromJwt, JWTCircuitHelper, register_contract } from "../utils/jwt";
import { fetchGooglePublicKey } from "../utils/google";
import { circuit } from "../utils/jwt_circuit";
import { Blob } from "hyli";

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
        try {
            console.log("[Hyli][Google] verifyGoogleIdToken() called");
        } catch {}
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

    private async addSessionKeyOnChain(username: string, sessionKey: SessionKey, onWalletEvent?: WalletEventCallback) {
        try {
            console.log("[Hyli][Google] addSessionKeyOnChain() called", {
                username,
                hasWhitelist: !!sessionKey.whitelist,
            });
        } catch {}
        // username is the on-chain account name (e.g., email), identity is `${username}@wallet`
        const identity = `${username}@${walletContractName}`;
        const nonce = await IndexerService.getInstance()
            .getAccountInfo(username)
            .then((info) => info.nonce + 1)
            .catch(() => 1);
        // Build blob for the wallet contract with the account field set to the username
        const blob = addSessionKeyBlob(
            username,
            sessionKey.publicKey,
            sessionKey.expiration,
            sessionKey.whitelist,
            sessionKey.laneId,
        );
        try {
            console.log("[Hyli][Google] addSessionKeyOnChain() sending blob", { identity, nonce });
        } catch {}
        const txHash = await NodeService.getInstance().client.sendBlobTx({ identity, blobs: [blob] } as any);
        // On émet un WalletEvent (pas un TransactionCallback)
        this.notifyTxAsWalletEvent(onWalletEvent, identity, txHash, "AddSessionKey");
    }

    // ---------- AuthProvider API ----------
    async login(params: LoginParams<GoogleAuthCredentials>): Promise<AuthResult> {
        console.log("[Hyli][Google] login() called");
        const nodeService = NodeService.getInstance();
        const { credentials, onWalletEvent, onError, registerSessionKey } = params;
        try {
            if (!credentials?.googleToken) {
                return { success: false, error: "Google token is required" };
            }

            if (!credentials?.username) {
                return { success: false, error: "Username is required" };
            }

            const g = await this.verifyGoogleIdToken(credentials.googleToken);
            const username = credentials.username.toLowerCase();
            const account = `${username}@${walletContractName}`;

            console.log("[Hyli][Google] Login flow", {
                username,
                sub: g.sub,
                email: g.email,
                account,
            });

            onWalletEvent?.({ account, type: "checking_password", message: "Verifying Google identity…" });

            const jwtBlobData = await this.buildCheckJwtBlob(credentials.googleToken, onError);

            if (jwtBlobData instanceof Error) {
                return { success: false, error: jwtBlobData.message };
            }

            console.log("Blob0 data (stored_hash):", jwtBlobData.blob.data);

            const blob1 = verifyIdentityBlob(username, jwtBlobData.nonce);

            const blobTx: BlobTransaction = {
                identity: account,
                blobs: [jwtBlobData.blob, blob1],
            };

            let newSessionKey;
            if (registerSessionKey) {
                const { duration, whitelist } = registerSessionKey;
                const expiration = Date.now() + duration; // still in milliseconds
                newSessionKey = sessionKeyService.generateSessionKey(expiration, whitelist);
                blobTx.blobs.push(addSessionKeyBlob(username, newSessionKey.publicKey, expiration, whitelist));
            }

            await register_contract(nodeService.client, circuit as any);

            onWalletEvent?.({ account, type: "sending_blob", message: `Sending blob transaction` });
            // Skipped, to make sure we send the proof alongside.
            const txHash = await nodeService.client.sendBlobTx(blobTx);
            onWalletEvent?.({ account, type: "blob_sent", message: `Blob transaction sent: ${txHash}` });

            // Create initial wallet state
            const wallet: Wallet = {
                username,
                address: account,
                salt: "",
            };

            onWalletEvent?.({ account, type: "custom", message: `Generating proof of jwt` });

            const mailHashBigInt = bytesToBigInt(jwtBlobData.mail_hash.value);

            // Generate proof using JWT circuit
            const proof_tx = await JWTCircuitHelper.generateProofTx({
                identity: account,
                stored_hash: jwtBlobData.blob.data,
                tx: txHash,
                blob_index: 0,
                tx_blob_count: 2,
                idToken: credentials.googleToken,
                jwtPubkey: jwtBlobData.pubkey,
                mail_hash: mailHashBigInt.toString(),
                nonce: jwtBlobData.nonce.toString(),
            });

            console.log("Generated JWT proof:", proof_tx);

            const proof_hash = await nodeService.client.sendProofTx(proof_tx);

            if (newSessionKey) {
                wallet.sessionKey = newSessionKey;
            }

            if (registerSessionKey?.duration) {
                const sk = await this.newSessionKey(
                    registerSessionKey.duration,
                    registerSessionKey.whitelist,
                    registerSessionKey.laneId,
                );
                await this.addSessionKeyOnChain(username, sk, onWalletEvent);
                wallet.sessionKey = sk;
            }

            onWalletEvent?.({ account, type: "logged_in", message: "Login successful" });
            return { success: true, wallet };
        } catch (e: any) {
            onError?.(e);
            return { success: false, error: e?.message ?? "Google login failed" };
        }
    }

    async buildCheckJwtBlob(
        googleToken: string,
        onError?: (error: Error) => void,
    ): Promise<{ blob: Blob; nonce: number; mail_hash: Fr; pubkey: JsonWebKey } | Error> {
        const { email, nonce, kid } = extractClaimsFromJwt(googleToken);

        if (!email || !nonce || !kid) {
            const error = "Invalid Google token: missing email, nonce, or kid";
            onError?.(new Error(error));
            return new Error(error);
        }

        // Get Google pubkey
        const googleJWTPubkey = await fetchGooglePublicKey(kid);

        let mail_hash: Fr = Fr.ZERO;

        console.log("Computing mail_hash for email", email);
        const bb = await Barretenberg.new();
        console.log("selected_mail", email);
        console.log("email byte array", new TextEncoder().encode(email));
        console.log("email bigint:", bytesToBigInt(new TextEncoder().encode(email)));
        mail_hash = await bb.poseidon2Hash([new Fr(bytesToBigInt(new TextEncoder().encode(email)))]).catch((err) => {
            console.error("Error computing poseidon hash:", err);
            throw err;
        });

        console.log("Computed mail_hash:", mail_hash);
        console.log("mail_hash as bigint:", bytesToBigInt(mail_hash.value));
        console.log("mail_hash as hex:", mail_hash.toString());

        // Generate proof using JWT circuit

        return {
            nonce: parseInt(nonce, 10),
            mail_hash,
            pubkey: googleJWTPubkey,
            blob: build_check_jwt_blob(mail_hash.value, nonce, googleJWTPubkey.n as string) as Blob,
        };
    }

    async register(params: RegisterAccountParams<GoogleAuthCredentials>): Promise<AuthResult> {
        console.log("[Hyli][Google] register() called");
        const nodeService = NodeService.getInstance();
        const { onError, registerSessionKey, onWalletEvent } = params;
        try {
            const { username, inviteCode, googleToken } = params.credentials;

            const identity = `${username}@${walletContractName}`;

            console.log("[Hyli][Google] Register flow CALLLLLL", { username, inviteCode, googleToken });

            const indexerService = IndexerService.getInstance();
            try {
                const accountInfo = await indexerService.getAccountInfo(identity);
                if (accountInfo) {
                    const error = `Account with username "${identity}" already exists.`;
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

            const jwtBlobData = await this.buildCheckJwtBlob(googleToken, onError);

            if (jwtBlobData instanceof Error) {
                return { success: false, error: jwtBlobData.message };
            }

            console.log("Blob0 data (stored_hash):", jwtBlobData.blob.data);

            const blob1 = registerBlob(
                username,
                jwtBlobData.nonce,
                "",
                { Jwt: { hash: Array.from(jwtBlobData.mail_hash.value) } },
                inviteCode,
            );

            const blobTx: BlobTransaction = {
                identity,
                blobs: [jwtBlobData.blob, blob1, inviteCodeBlob],
            };

            let newSessionKey;
            if (registerSessionKey) {
                const { duration, whitelist } = registerSessionKey;
                const expiration = Date.now() + duration; // still in milliseconds
                newSessionKey = sessionKeyService.generateSessionKey(expiration, whitelist);
                blobTx.blobs.push(addSessionKeyBlob(username, newSessionKey.publicKey, expiration, whitelist));
            }

            await register_contract(nodeService.client, circuit as any);

            onWalletEvent?.({ account: identity, type: "sending_blob", message: `Sending blob transaction` });
            // Skipped, to make sure we send the proof alongside.
            const txHash = await nodeService.client.sendBlobTx(blobTx);
            onWalletEvent?.({ account: identity, type: "blob_sent", message: `Blob transaction sent: ${txHash}` });

            // Create initial wallet state
            const wallet: Wallet = {
                username,
                address: identity,
                salt: "",
            };

            onWalletEvent?.({ account: identity, type: "custom", message: `Generating proof of jwt` });

            const mailHashBigInt = bytesToBigInt(jwtBlobData.mail_hash.value);

            // Generate proof using JWT circuit
            const proof_tx = await JWTCircuitHelper.generateProofTx({
                identity,
                stored_hash: jwtBlobData.blob.data,
                tx: txHash,
                blob_index: 0,
                tx_blob_count: 3,
                idToken: googleToken,
                jwtPubkey: jwtBlobData.pubkey,
                mail_hash: mailHashBigInt.toString(),
                nonce: jwtBlobData.nonce.toString(),
            });

            console.log("Generated JWT proof:", proof_tx);

            const proof_hash = await nodeService.client.sendProofTx(proof_tx);

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
