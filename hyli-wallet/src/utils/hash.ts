import { sha3_256 } from "js-sha3";

// --- Hashing utilities for Blob and BlobTransaction ---

const MAP_HEX = {
    0: 0,
    1: 1,
    2: 2,
    3: 3,
    4: 4,
    5: 5,
    6: 6,
    7: 7,
    8: 8,
    9: 9,
    a: 10,
    b: 11,
    c: 12,
    d: 13,
    e: 14,
    f: 15,
    A: 10,
    B: 11,
    C: 12,
    D: 13,
    E: 14,
    F: 15,
};

export const hexToBytes = (hexString: string): Uint8Array => {
    if ("FromHex" in Uint8Array.prototype) {
        console.warn("Using Uint8Array.FromHex, which may not be supported in all environments.");
        // @ts-expect-error
        return Uint8Array.FromHex(hexString);
    }
    // Copied from https://stackoverflow.com/questions/38987784/how-to-convert-a-hexadecimal-string-to-uint8array-and-back-in-javascript
    const bytes = new Uint8Array(Math.floor((hexString || "").length / 2));
    let i;
    for (i = 0; i < bytes.length; i++) {
        const a = MAP_HEX[hexString[i * 2] as keyof typeof MAP_HEX];
        const b = MAP_HEX[hexString[i * 2 + 1] as keyof typeof MAP_HEX];
        if (a === undefined || b === undefined) {
            break;
        }
        bytes[i] = (a << 4) | b;
    }
    return i === bytes.length ? bytes : bytes.slice(0, i);
};

export const encodeToHex = (data: Uint8Array | number[]): string => {
    return (() => {
        if (data instanceof Uint8Array) {
            return Array.from(data);
        } else if (Array.isArray(data)) {
            return data;
        } else {
            throw new TypeError("Unsupported data type for encodeToHex");
        }
    })()
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
