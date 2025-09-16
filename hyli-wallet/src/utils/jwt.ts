import { generateInputs } from "noir-jwt";
import { InputMap, type CompiledCircuit } from "@noir-lang/noir_js";
import { initProver, initVerifier } from "./lazy-modules";
import { circuit as circuitArtifact } from "./jwt_circuit";
import { assert, flattenFieldsAsArray } from "hyli-check-secret";
import { Contract, NodeApiHttpClient } from "hyli";
import { reconstructHonkProof, UltraHonkBackend } from "@aztec/bb.js";
import { reconstructUltraPlonkProof } from "@aztec/bb.js/dest/node-cjs/proof";

export function bytesToBigInt(bytes: Uint8Array) {
    let result = BigInt(0);
    for (let i = 0; i < bytes.length; i++) {
        result = (result << BigInt(8)) + BigInt(bytes[i]);
    }
    return result;
}

function splitBigIntToLimbs(bigInt: bigint, byteLength: number, numLimbs: number): bigint[] {
    const chunks: bigint[] = [];
    const mask = (1n << BigInt(byteLength)) - 1n;
    for (let i = 0; i < numLimbs; i++) {
        const chunk = (bigInt / (1n << (BigInt(i) * BigInt(byteLength)))) & mask;
        chunks.push(chunk);
    }
    return chunks;
}

export async function pubkeyModulusFromJWK(jwk: JsonWebKey) {
    // Parse pubkeyJWK
    const publicKey = await crypto.subtle.importKey(
        "jwk",
        jwk,
        {
            name: "RSASSA-PKCS1-v1_5",
            hash: "SHA-256",
        },
        true,
        ["verify"],
    );

    const publicKeyJWK = await crypto.subtle.exportKey("jwk", publicKey);
    const modulusBigInt = BigInt("0x" + Buffer.from(publicKeyJWK.n as string, "base64").toString("hex"));

    return modulusBigInt;
}

const generateProverData = (
    id: string,
    stored_hash: number[],
    tx: string,
    blob_index: number,
    tx_blob_count: number,
): InputMap => {
    const version = 1;
    const initial_state = [0, 0, 0, 0];
    const initial_state_len = initial_state.length;
    const next_state = [0, 0, 0, 0];
    const next_state_len = next_state.length;
    const identity_len = id.length;
    const identity = id.padEnd(256, "0");
    const tx_hash = tx.padEnd(64, "0");
    const tx_hash_len = tx.length;
    const index = blob_index;
    const blob_number = 1;
    const blob_contract_name_len = "check_jwt".length;
    const blob_contract_name = "check_jwt".padEnd(256, "0");
    const blob_capacity = 306;
    const blob_len = 306;
    const blob: number[] = stored_hash;
    const success = 1;
    console.log("Blob data", blob);
    assert(blob.length == blob_len, `Blob length is ${blob.length} not 306 bytes`);

    return {
        version,
        initial_state,
        initial_state_len,
        next_state,
        next_state_len,
        identity,
        identity_len,
        tx_hash,
        tx_hash_len,
        index,
        blob_number,
        blob_index,
        blob_contract_name_len,
        blob_contract_name,
        blob_capacity,
        blob_len,
        blob,
        tx_blob_count,
        success,
    };
    /*
	  // Hyli output infos
    version: pub u32,
    initial_state_len: pub u32,
    initial_state: pub [u8; 4],
    next_state_len: pub u32,
    next_state: pub [u8; 4],
    identity_len: pub u8,
    identity: pub str<256>,
    tx_hash: pub str<64>,
    // ------ Blobs ------
    index: pub u32,
    blob_number: pub u32,
    // --- Blob
    blob_index: pub u32,
    blob_contract_name_len: pub u8,
    blob_contract_name: pub str<256>,
    blob_capacity: pub u32,
    blob_len: pub u32,
    blob: pub [u8; 306],
    tx_blob_count: pub u32,
    success: pub bool,
    // whats needed to build something that matches what is in blob field
    partial_data: BoundedVec<u8, MAX_PARTIAL_DATA_LENGTH>,
    partial_hash: [u32; 8],
    full_data_length: u32,
    base64_decode_offset: u32,
    jwt_pubkey_modulus_limbs: [u128; 18],
    jwt_pubkey_redc_params_limbs: [u128; 18],
    jwt_signature_limbs: [u128; 18],
    public_nonce: Field,
    public_email_hash: Field,
) {*/
};

export const extractClaimsFromJwt = (jwt: string): { email: string; nonce: string; kid: string } => {
    const [header, payload] = jwt.split(".");
    const headers = JSON.parse(atob(header));
    const json = JSON.parse(atob(payload));
    console.log("Decoded JWT payload:", json);
    console.log("Decoded JWT headers payload:", headers);
    const email = json.email.toLowerCase();
    const nonce = json.nonce.toLowerCase();
    const kid = headers.kid;

    return { email, nonce, kid };
};

export const JWTCircuitHelper = {
    version: "0.3.1",
    generateProofTx: async ({
        identity,
        stored_hash,
        tx,
        blob_index,
        tx_blob_count,
        idToken,
        jwtPubkey,
        nonce,
        mail_hash,
    }: {
        identity: string;
        stored_hash: number[];
        tx: string;
        blob_index: number;
        tx_blob_count: number;
        idToken: string;
        jwtPubkey: JsonWebKey;
        nonce: string;
        mail_hash: string;
    }) => {
        if (!idToken || !jwtPubkey) {
            throw new Error("[JWT Circuit] Proof generation failed: idToken and jwtPubkey are required");
        }

        const jwtInputs = await generateInputs({
            jwt: idToken,
            pubkey: jwtPubkey,
            shaPrecomputeTillKeys: ["email", "email_verified", "nonce"],
            maxSignedDataLength: 640,
        });

        const inputs = {
            ...generateProverData(identity, stored_hash, tx, blob_index, tx_blob_count),
            partial_data: jwtInputs.partial_data,
            partial_hash: jwtInputs.partial_hash,
            full_data_length: jwtInputs.full_data_length,
            base64_decode_offset: jwtInputs.base64_decode_offset,
            jwt_pubkey_modulus_limbs: jwtInputs.pubkey_modulus_limbs,
            jwt_pubkey_redc_params_limbs: jwtInputs.redc_params_limbs,
            jwt_signature_limbs: jwtInputs.signature_limbs,
            public_email_hash: mail_hash,
            public_nonce: nonce,
        };

        console.log("JWT circuit inputs", inputs);

        const { Noir, UltraHonkBackend } = await initProver();
        console.log("Noir, UltraHonkBackend", Noir, UltraHonkBackend);

        const backend = new UltraHonkBackend(circuitArtifact.bytecode, { threads: 8 });
        const vk = await backend.getVerificationKey();
        const noir = new Noir(circuitArtifact as CompiledCircuit);

        // Generate witness and prove
        const startTime = performance.now();
        const { witness } = await noir.execute(inputs as InputMap).catch((err: any) => {
            console.error("Error executing circuit:", err);
            throw err;
        });

        console.log("witness", witness);
        const proof = await backend.generateProof(witness).catch((err: any) => {
            console.error("Error generating proof:", err);
            throw err;
        });
        const provingTime = performance.now() - startTime;

        const reconstructedProof = reconstructHonkProof(flattenFieldsAsArray(proof.publicInputs), proof.proof);

        console.log(`Proof generated in ${provingTime}ms`);

        return {
            contract_name: "check_jwt",
            program_id: Array.from(vk),
            verifier: "noir",
            proof: Array.from(reconstructedProof),
        };
    },
};

/**
 * Registers the Noir contract with the node if it is not already registered.
 * The contract is identified by its name "check_secret".
 * If the contract is not found, it registers the contract using the provided circuit.
 *
 * @param node - The NodeApiHttpClient instance to interact with the NodeApiHttpClient
 * @param circuit - The compiled Noir circuit (defaults to the check_secret circuit)
 * @returns A Promise that resolves when the contract is registered
 */
export const register_contract = async (
    node: NodeApiHttpClient,
    circuit: CompiledCircuit,
): Promise<undefined | number[]> => {
    return await node
        .getContract("check_jwt")
        .then(() => undefined)
        .catch(async () => {
            const backend = new UltraHonkBackend(circuit.bytecode);

            const vk = await backend.getVerificationKey();
            const contract = {
                verifier: "noir",
                program_id: Array.from(vk),
                state_commitment: [0, 0, 0, 0],
                contract_name: "check_jwt",
            };
            await node.registerContract(contract);
            return contract.program_id;
        });
};
