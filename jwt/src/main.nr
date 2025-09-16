use jwt::JWT;
use poseidon::poseidon2::Poseidon2Hasher;
use std::hash::Hasher;

global MAX_PARTIAL_DATA_LENGTH: u32 = 640; // signed data length after partial SHA
global MAX_EMAIL_LENGTH: u32 = 77;
global NONCE_LENGTH: u32 = 16;

/**
 * @brief Verify JWT signature (RSA/SHA256 only) and validate hd and nonce fields
 *
 * @param partial_data: OIDC JWT (id_token) base64 data (`$header.$payload`) as byte array of ascii characters
 *                      We do partial SHA on the data up to hd field outside of the circuit, to reduce constraints
 *                      This field only contains the bytes after partial SHA; padded to MAX_PARTIAL_DATA_LENGTH
 * @param partial_hash: The 256-bit partial hash of the `data`
 * @param full_data_length: The full length of the `data` (before partial SHA)
 * @param b64_offset: Offset needed in `partial_data` to make the payloadB64 a multiple of 4
 *                    Signed data is $header.$payload. $payload might not be a multiple of 4 in `partial_data`, so we need to offset
 *                    Not attack-able by giving an incorrect offset, as string match of hd and nonce will fail
 * @param jwt_pubkey_modulus_limbs: RSA public key modulus limbs (2048-bit split into 18 limbs)
 * @param jwt_pubkey_redc_params_limbs: RSA reduction parameters limbs
 * @param jwt_signature_limbs: RSA signature limbs
 * @param domain: Domain name (`hd` key) as a byte array of ascii characters padded to MAX_DOMAIN_LENGTH
 * @param ephemeral_pubkey: Public key of the ephemeral keypair that is used to sign messages
 * @param ephemeral_pubkey_salt: Salt of the ephemeral keypair that is used to sign messages
 * @param ephemeral_pubkey_expiry: Expiry of the ephemeral keypair that is used to sign messages
 * @param nonce: JWT `nonce` as a byte array of ascii characters - 32 bytes
 **/
fn main(
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
) {
    // Init JWT struct and verify signature
    let jwt = JWT::init_with_partial_hash(
        partial_data,
        partial_hash,
        full_data_length,
        base64_decode_offset,
        jwt_pubkey_modulus_limbs,
        jwt_pubkey_redc_params_limbs,
        jwt_signature_limbs,
    );
    jwt.verify();

    // Get nonce claim
    let nonce: BoundedVec<u8, NONCE_LENGTH> = jwt.get_claim_string("nonce".as_bytes());

    // Assert email_verified claim
    jwt.assert_claim_bool("email_verified".as_bytes(), true);

    // Get email claim
    let email: BoundedVec<u8, MAX_EMAIL_LENGTH> = jwt.get_claim_string("email".as_bytes());
    let email_field: Field = bytes_to_field(email.storage(), email.len());

    let mut hasher = Poseidon2Hasher::default();
    hasher.write(email_field);
    let email_hash: Field = hasher.finish();

    // email_hash:nonce:pubkey
    let mut built_blob: BoundedVec<u8, 306> = BoundedVec::new();
    built_blob.extend_from_array(email_hash.to_be_bytes::<32>());
    built_blob.extend_from_slice(":".as_bytes());
    built_blob.extend_from_slice(nonce.storage());
    built_blob.extend_from_slice(":".as_bytes());
    built_blob.extend_from_slice(joinLimbsToBigInt(jwt_pubkey_modulus_limbs).storage());

    assert(email_hash == bytes_to_field(built_blob.storage(), 32), "blob mail");

    assert(blob == built_blob.storage(), "blob not matching");

    // Hyli specific asserts

    assert(success == true);
    assert(version == 1);
    assert(initial_state_len == 4);
    assert(next_state_len == 4);
    assert(initial_state == [0; 4]);
    assert(next_state == [0; 4]);
    assert(blob_capacity == 306);
    assert(blob_len == 306);
    assert(blob_number == 1);
    assert(tx_blob_count >= 1);
}

fn bytes_to_field<let LEN: u32>(bytes: [u8; LEN], len: u32) -> Field {
    let mut result: Field = 0;
    for i in 0..LEN {
        // Big-endian: on "pousse" de 8 bits (= *256) puis on ajoute l'octet courant

        if i < len {
            result = result * 256 + (bytes[i] as Field);
        }
    }
    result
}

fn u128_to_bytes(x: u128) -> [u8; 16] {
    let mut out: [u8; 16] = [0; 16];

    for i in 0..16 {
        let shifted: u128 = x >> (i * 8);
        // On garde uniquement les 8 bits de poids faible
        out[i] = (shifted & 0xff) as u8;
    }

    out
}

// last byte of each limb should be 0, that is why we skip it
fn joinLimbsToBigInt(limbs: [u128; 18]) -> BoundedVec<u8, 256> {
    let mut result = BoundedVec::new();
    for i in 0..17 {
        let sub: [u8] = u128_to_bytes(limbs[i]).as_slice();
        let (sub, zero) = sub.pop_back();
        let sub: [u8; 15] = sub.as_array();

        assert(zero == 0);
        result.extend_from_array(sub);
    }

    result.extend_from_slice([u128_to_bytes(limbs[17])[0]]);
    result
}

#[test]
fn encode_decode() {
    let truc = 1234567890;
    let result = bytes_to_field(u128_to_bytes(truc), 16) as u128;
    println(truc);
    println(result);

    assert_eq(truc, result, "dommach");
}
