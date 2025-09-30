// GoogleAuthProvider.ts
// Use Web Crypto API in browser instead of Node 'crypto'
import { AuthProvider, RegisterAccountParams, LoginParams } from "./BaseAuthProvider";
import {
    Wallet,
    registerBlob,
    verifyIdentityBlob,
    addSessionKeyBlob, // <- version corrigée ci-dessus
    walletContractName,
    WalletErrorCallback,
} from "../types/wallet"; // ajuste le chemin si besoin

import { BlobTransaction } from "hyli"; // ajuste le chemin si besoin
import { NodeService } from "../services/NodeService";
import { IndexerService } from "../services/IndexerService";
import { sessionKeyService } from "../services/SessionKeyService";

import * as WalletOperations from "../services/WalletOperations";
import { check_jwt } from "hyli-noir";
import { fetchGooglePublicKeys } from "../utils/google";
import { AuthCredentials, AuthResult } from "../types/auth";

export interface GoogleAuthCredentials extends AuthCredentials {
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

    private async checkGoogleAccount(username: string, mail_hash: number[], onError?: WalletErrorCallback) {
        const userAccountInfo = await IndexerService.getInstance().getAccountInfo(username);
        if (!("Jwt" in userAccountInfo.auth_method)) {
            return { success: false, error: "Auth Method should be Jwt" };
        }
        let storedHash = userAccountInfo.auth_method.Jwt.hash;

        console.log(storedHash);
        console.log(mail_hash);

        if (mail_hash.toString() != storedHash.toString()) {
            onError?.(new Error("Invalid Google account"));
            return { success: false, error: "Invalid Google account" };
        }

        return { success: true };
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

            const username = credentials.username.toLowerCase();

            const account = `${username}@${walletContractName}`;

            onWalletEvent?.({ account, type: "checking_password", message: "Verifying Google identity…" });

            await this.verifyGoogleIdToken(credentials.googleToken);
            const { keys } = await fetchGooglePublicKeys();

            const jwtBlobData = await check_jwt.build_blob_from_jwt(credentials.googleToken, keys);

            const { success: checked_success, error } = await this.checkGoogleAccount(
                username,
                jwtBlobData.mail_hash,
                onError
            );

            if (!checked_success) {
                onError?.(new Error(error!));
                return { success: false, error: error ?? "Google account check failed" };
            }

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

            await check_jwt.register_contract(nodeService.client);

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

            // Generate proof using JWT circuit
            const proof_tx = await check_jwt.build_proof_transaction(
                account,
                jwtBlobData.blob.data,
                txHash,
                0,
                2,
                credentials.googleToken,
                jwtBlobData.pubkey
            );

            await nodeService.client.sendProofTx(proof_tx);

            if (newSessionKey) {
                wallet.sessionKey = newSessionKey;
            }

            onWalletEvent?.({ account, type: "logged_in", message: "Login successful" });
            return { success: true, wallet };
        } catch (e: any) {
            onError?.(e);
            return { success: false, error: e?.message ?? "Google login failed" };
        }
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

            const { keys } = await fetchGooglePublicKeys();

            const jwtBlobData = await check_jwt.build_blob_from_jwt(googleToken, keys);

            if (jwtBlobData instanceof Error) {
                return { success: false, error: jwtBlobData.message };
            }

            console.log("Blob0 data (stored_hash):", jwtBlobData.blob.data);

            const blob1 = registerBlob(
                username,
                jwtBlobData.nonce,
                "",
                { Jwt: { hash: jwtBlobData.mail_hash } },
                inviteCode
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

            await check_jwt.register_contract(nodeService.client);

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

            // Generate proof using JWT circuit
            const proof_tx = await check_jwt.build_proof_transaction(
                identity,
                jwtBlobData.blob.data,
                txHash,
                0,
                3,
                googleToken,
                jwtBlobData.pubkey
            );

            await nodeService.client.sendProofTx(proof_tx);

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
