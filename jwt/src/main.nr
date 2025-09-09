use jwt::JWT;
use poseidon::poseidon2::Poseidon2Hasher;
use std::hash::Hasher;

global MAX_PARTIAL_DATA_LENGTH: u32 = 640; // signed data length after partial SHA
global MAX_EMAIL_LENGTH: u32 = 77;
global NONCE_LENGTH: u32 = 77;

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
    partial_data: BoundedVec<u8, MAX_PARTIAL_DATA_LENGTH>,
    partial_hash: [u32; 8],
    full_data_length: u32,
    base64_decode_offset: u32,
    jwt_pubkey_modulus_limbs: pub [u128; 18],
    jwt_pubkey_redc_params_limbs: [u128; 18],
    jwt_signature_limbs: [u128; 18],
    public_nonce: pub Field,
    public_email_hash: pub Field,
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
    let nonce_field: Field = decimal_string_to_field(nonce.storage());

    println(nonce_field as u128);

    assert(nonce_field == public_nonce, "invalid nonce");

    // Assert email_verified claim
    jwt.assert_claim_bool("email_verified".as_bytes(), true);

    // Get email claim
    let email: BoundedVec<u8, MAX_EMAIL_LENGTH> = jwt.get_claim_string("email".as_bytes());
    let email_field: Field = bytes_to_field(email.storage(), email.len());
    println(email);
    println(email_field as u128);

    let mut hasher = Poseidon2Hasher::default();
    hasher.write(email_field);
    let email_hash: Field = hasher.finish();

    println(email_hash);
    println(public_email_hash);

    //assert(email_hash == public_email_hash, "invalid mail hash");
}

fn bytes_to_field<let LEN: u32>(bytes: [u8; LEN], len: u32) -> Field {
    let mut result: Field = 0;
    for i in 0..LEN {
        // Big-endian: on "pousse" de 8 bits (= *256) puis on ajoute l'octet courant

        if i < len {
            result = result * 256 + (bytes[i] as Field);
            println(result);
        }
    }
    result
}

fn decimal_string_to_field<let LEN: u32>(decimal_bytes: [u8; LEN]) -> Field {
    assert(LEN <= 77);

    let mut field: Field = 0;
    let mut multiplier: Field = 1;

    for i in 0..LEN {
        let ascii_char = decimal_bytes[LEN - i - 1];
        if ascii_char >= 48 & ascii_char <= 57 {
            let digit = ascii_char as Field - 48;
            field += digit * multiplier;
            multiplier *= 10;
        }
    }

    field
}
