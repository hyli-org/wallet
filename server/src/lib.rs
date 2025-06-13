use std::env;

use secp256k1::{PublicKey, Secp256k1, SecretKey};
use wallet::client::tx_executor_handler::{Wallet, WalletConstructor};

pub mod conf;

pub fn new_wallet() -> Wallet {
    let secp = Secp256k1::new();
    let secret_key =
        hex::decode(env::var("INVITE_CODE_PKEY").unwrap_or(
            "0000000000000001000000000000000100000000000000010000000000000001".to_string(),
        ))
        .expect("INVITE_CODE_PKEY must be a hex string");
    let secret_key = SecretKey::from_slice(&secret_key).expect("32 bytes, within curve order");
    let public_key = PublicKey::from_secret_key(&secp, &secret_key);

    let hyli_password = env::var("HYLI_PASSWORD").unwrap_or("hylisecure".to_string());
    let wallet_constructor = WalletConstructor::new(hyli_password, public_key.serialize());
    Wallet::new(&Some(wallet_constructor.clone())).expect("must succeed")
}
