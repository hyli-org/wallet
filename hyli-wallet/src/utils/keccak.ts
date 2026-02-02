import { keccak_256 } from "js-sha3";

/**
 * Compute Keccak-256 hash of input data
 * @param data - String or Uint8Array to hash
 * @returns 32-byte Uint8Array hash
 */
export function keccak256(data: string | Uint8Array): Uint8Array {
    if (typeof data === "string") {
        return new Uint8Array(keccak_256.arrayBuffer(data));
    }
    return new Uint8Array(keccak_256.arrayBuffer(data));
}
