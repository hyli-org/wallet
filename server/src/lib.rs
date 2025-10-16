use std::env;

use secp256k1::{PublicKey, Secp256k1, SecretKey};
use wallet::client::tx_executor_handler::{Wallet, WalletConstructor};

mod app;
pub mod conf;
mod history;
mod init;
pub mod sdk_wallet;

pub fn new_wallet(contract_name: &sdk::ContractName) -> (WalletConstructor, Wallet) {
    let secp = Secp256k1::new();
    let secret_key =
        hex::decode(env::var("INVITE_CODE_PKEY").unwrap_or(
            "0000000000000001000000000000000100000000000000010000000000000001".to_string(),
        ))
        .expect("INVITE_CODE_PKEY must be a hex string");
    let secret_key = SecretKey::from_byte_array(secret_key.try_into().expect("32 bytes"))
        .expect("32 bytes, within curve order");
    let public_key = PublicKey::from_secret_key(&secp, &secret_key);

    let hyli_password = env::var("HYLI_PASSWORD").unwrap_or("hylisecure".to_string());
    let wallet_constructor = WalletConstructor::new(hyli_password, public_key.serialize());

    (
        wallet_constructor.clone(),
        Wallet::new(contract_name, &Some(wallet_constructor)).expect("must succeed"),
    )
}
