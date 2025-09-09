import { generateInputs } from "noir-jwt";
import { InputMap, type CompiledCircuit } from "@noir-lang/noir_js";
import { initProver, initVerifier } from "./lazy-modules";
import { circuit as circuitArtifact } from "./jwt_circuit";

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

export const JWTCircuitHelper = {
    version: "0.3.1",
    generateProof: async ({
        idToken,
        jwtPubkey,
        nonce,
        mail_hash,
    }: {
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
        console.log("backend", backend);

        const noir = new Noir(circuitArtifact as CompiledCircuit);
        console.log("noir", noir);

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

        console.log(`Proof generated in ${provingTime}ms`);

        return proof;
    },
};
