import { ec as EC } from "elliptic";

const secp256k1 = new EC("secp256k1");

/**
 * Decompress a 33-byte compressed secp256k1 public key to 65-byte uncompressed format
 * @param compressedPubKey - 33 bytes compressed public key
 * @returns 65 bytes uncompressed public key (0x04 prefix + 32 bytes X + 32 bytes Y)
 */
export function decompressPublicKey(compressedPubKey: Uint8Array): Uint8Array {
    if (compressedPubKey.length !== 33) {
        throw new Error(`Invalid compressed public key length: expected 33, got ${compressedPubKey.length}`);
    }

    const point = secp256k1.keyFromPublic(compressedPubKey).getPublic();
    const x = point.getX().toArray("be", 32);
    const y = point.getY().toArray("be", 32);

    // Uncompressed format: 0x04 + X (32 bytes) + Y (32 bytes)
    const uncompressed = new Uint8Array(65);
    uncompressed[0] = 0x04;
    uncompressed.set(x, 1);
    uncompressed.set(y, 33);

    return uncompressed;
}

/**
 * Convert hex string to 64-byte secp256k1 signature (r + s)
 */
export function hexToSecp256k1Signature(hex: string): Uint8Array {
    const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (cleanHex.length !== 128) {
        throw new Error(`Invalid signature length: expected 128 hex chars (64 bytes), got ${cleanHex.length}`);
    }
    const bytes = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
        bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

/**
 * Convert hex string to 33-byte compressed secp256k1 public key
 */
export function hexToSecp256k1PublicKey(hex: string): Uint8Array {
    const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (cleanHex.length !== 66) {
        throw new Error(`Invalid public key length: expected 66 hex chars (33 bytes), got ${cleanHex.length}`);
    }
    const bytes = new Uint8Array(33);
    for (let i = 0; i < 33; i++) {
        bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

/**
 * Verify a secp256k1 signature
 * @param message - The message hash (32 bytes) that was signed
 * @param signature - The 64-byte signature (r + s)
 * @param publicKey - The 33-byte compressed public key
 * @returns true if signature is valid
 */
export function verifySecp256k1Signature(
    message: Uint8Array,
    signature: Uint8Array,
    publicKey: Uint8Array
): boolean {
    try {
        const key = secp256k1.keyFromPublic(publicKey);
        // Convert signature to { r, s } format
        const r = signature.slice(0, 32);
        const s = signature.slice(32, 64);
        const sig = { r: Array.from(r), s: Array.from(s) };
        return key.verify(message, sig);
    } catch (error) {
        console.error("Signature verification error:", error);
        return false;
    }
}
