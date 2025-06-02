import EC from "elliptic";
import { SHA256 } from "crypto-js";
import { Buffer } from "buffer";
import { Secp256k1Blob, SessionKey } from "../types/wallet";

export class SessionKeyService {
    private ec: EC.ec;

    constructor() {
        this.ec = new EC.ec("secp256k1");
    }

    generateSessionKey(expiration: number, whitelist?: string[]): SessionKey {
        const keyPair = this.ec.genKeyPair();

        const privateKey = keyPair.getPrivate("hex");
        if (!privateKey) {
            throw new Error("Failed to generate private key");
        }

        const publicKey = keyPair.getPublic(true, "hex");
        if (!publicKey) {
            throw new Error("Failed to generate public key");
        }

        const sessionKey: SessionKey = {
            publicKey,
            privateKey,
            expiration,
            whitelist,
        };

        return sessionKey;
    }

    signMessage(message: string, privateKey: string): [Uint8Array, Uint8Array] {
        const hash = SHA256(message);
        const hashBytes = Buffer.from(hash.toString(), "hex");

        if (hashBytes.length !== 32) {
            throw new Error("Hash length is not 32 bytes");
        }

        const keyPair = this.ec.keyFromPrivate(privateKey);
        const signature = keyPair.sign(hash.toString());

        // Normaliser s en utilisant min(s, n-s)
        const n = this.ec.curve.n;
        var s = signature.s;
        if (s.gt(n.shrn(1))) {
            signature.s = n.sub(s);
        }

        const signatureBytes = new Uint8Array([...signature.r.toArray("be", 32), ...signature.s.toArray("be", 32)]);

        return [hashBytes, signatureBytes];
    }

    getSignedBlob(identity: string, nonce: number, privateKey: string): Secp256k1Blob {
        const [hashBytes, signatureBytes] = this.signMessage(nonce.toString(), privateKey);

        const keyPair = this.ec.keyFromPrivate(privateKey);
        const publicKey = keyPair.getPublic(true, "hex");

        const secp256k1Blob: Secp256k1Blob = {
            identity: identity,
            data: hashBytes,
            public_key: new Uint8Array(Buffer.from(publicKey, "hex")),
            signature: signatureBytes,
        };
        return secp256k1Blob;
    }
}

export const sessionKeyService = new SessionKeyService();
