import { sha3_256 } from "js-sha3";

// --- Hashing utilities for Blob and BlobTransaction ---

export const encodeToHex = (data: Uint8Array): string => {
    return Array.from(data)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
};

export async function hashBlob(blob: { contract_name: string; data: number[] | Uint8Array }): Promise<string> {
    // contract_name as UTF-8 bytes, then blob.data as bytes
    const contractBytes = new TextEncoder().encode(blob.contract_name);
    const dataBytes = blob.data instanceof Uint8Array ? blob.data : new Uint8Array(blob.data);
    // Concatenate contract_name and data
    const input = new Uint8Array(contractBytes.length + dataBytes.length);
    input.set(contractBytes, 0);
    input.set(dataBytes, contractBytes.length);
    return encodeToHex(new Uint8Array(sha3_256.arrayBuffer(input)));
}

export async function hashBlobTransaction(tx: {
    identity: string;
    blobs: { contract_name: string; data: number[] | Uint8Array }[];
}): Promise<string> {
    // identity as UTF-8 bytes, then each blob's hash in order
    const identityBytes = new TextEncoder().encode(tx.identity);
    let input = new Uint8Array(identityBytes.length);
    input.set(identityBytes, 0);
    for (const blob of tx.blobs) {
        const blobHashBytes = new TextEncoder().encode(await hashBlob(blob)); // raw bytes
        // Concatenate input and blobHashBytes
        const newInput = new Uint8Array(input.length + blobHashBytes.length);
        newInput.set(input, 0);
        newInput.set(blobHashBytes, input.length);
        input = newInput;
    }
    return encodeToHex(new Uint8Array(sha3_256.arrayBuffer(input)));
}
