pub mod tx_executor_handler;
pub mod indexer;

pub mod metadata {
    pub const WALLET_ELF: &[u8] = include_bytes!("../../wallet.img");
    pub const PROGRAM_ID: [u8; 32] = sdk::str_to_u8(include_str!("../../wallet.txt"));
}
