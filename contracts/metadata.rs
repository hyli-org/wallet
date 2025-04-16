#[allow(unused)]
#[cfg(all(not(clippy), feature = "nonreproducible"))]
mod methods {
    include!(concat!(env!("OUT_DIR"), "/methods.rs"));
}

#[cfg(all(not(clippy), feature = "nonreproducible", feature = "all"))]
mod metadata {
    pub const WALLET_ELF: &[u8] = crate::methods::WALLET_ELF;
    pub const WALLET_ID: [u8; 32] = sdk::to_u8_array(&crate::methods::WALLET_ID);
}

#[cfg(any(clippy, not(feature = "nonreproducible")))]
mod metadata {
    pub const WALLET_ELF: &[u8] = wallet::client::metadata::WALLET_ELF;
    pub const WALLET_ID: [u8; 32] = wallet::client::metadata::PROGRAM_ID;
}

pub use metadata::*;
