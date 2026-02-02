import * as ed25519 from "@noble/ed25519";
import { hexToBytes, encodeToHex } from "./hash";

/**
 * Verify an Ed25519 signature
 * @param message - The message that was signed (32 bytes)
 * @param signature - The Ed25519 signature (64 bytes)
 * @param publicKey - The Ed25519 public key (32 bytes)
 * @returns true if the signature is valid
 */
export async function verifyEd25519Signature(
    message: Uint8Array,
    signature: Uint8Array,
    publicKey: Uint8Array
): Promise<boolean> {
    try {
        return await ed25519.verifyAsync(signature, message, publicKey);
    } catch {
        return false;
    }
}

/**
 * Convert Ed25519 public key bytes to hex string
 */
export function ed25519PublicKeyToHex(publicKey: Uint8Array): string {
    return encodeToHex(publicKey);
}

/**
 * Convert hex string to Ed25519 public key bytes
 */
export function hexToEd25519PublicKey(hex: string): Uint8Array {
    const bytes = hexToBytes(hex);
    if (bytes.length !== 32) {
        throw new Error(`Invalid Ed25519 public key length: expected 32 bytes, got ${bytes.length}`);
    }
    return bytes;
}

/**
 * Convert hex string to Ed25519 signature bytes
 */
export function hexToEd25519Signature(hex: string): Uint8Array {
    const bytes = hexToBytes(hex);
    if (bytes.length !== 64) {
        throw new Error(`Invalid Ed25519 signature length: expected 64 bytes, got ${bytes.length}`);
    }
    return bytes;
}
