use secp256k1::PublicKey;
use sha3::{digest::Digest, Keccak256};

pub fn parse_public_key(bytes: &[u8; 33]) -> Result<PublicKey, String> {
    PublicKey::from_slice(bytes).map_err(|_| "Invalid secp256k1 public key".to_string())
}

pub fn ethereum_address_from_public_key(public_key: &PublicKey) -> String {
    let uncompressed = public_key.serialize_uncompressed();
    let hash = Keccak256::digest(&uncompressed[1..]); // drop 0x04 prefix
    hex::encode(&hash[12..])
}
