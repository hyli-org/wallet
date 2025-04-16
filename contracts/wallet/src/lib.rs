use std::collections::BTreeMap;

use borsh::{io::Error, BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};

use sdk::RunResult;
use sha2::{Digest, Sha256};

#[cfg(feature = "client")]
pub mod client;

impl sdk::ZkContract for Wallet {
    /// Entry point of the contract's logic
    fn execute(&mut self, contract_input: &sdk::Calldata) -> RunResult {
        // Parse contract inputs
        let (action, ctx) = sdk::utils::parse_raw_calldata::<WalletAction>(contract_input)?;

        let check_secret = contract_input
            .blobs
            .iter()
            .find(|(_, b)| b.contract_name.0 == "check_secret")
            .map(|(_, b)| b.data.clone())
            .expect("Missing check_secret blob");

        let checked_hash = hex::encode(check_secret.0);

        // Execute the given action
        let res = match action {
            WalletAction::RegisterIdentity { account, nonce } => {
                self.register_identity(account, nonce, checked_hash)?
            }
            WalletAction::VerifyIdentity { account, nonce } => {
                self.verify_identity(account, nonce, checked_hash)?
            }
        };

        Ok((res, ctx, vec![]))
    }

    /// In this example, we serialize the full state on-chain.
    fn commit(&self) -> sdk::StateCommitment {
        sdk::StateCommitment(borsh::to_vec(&self).expect("Failed to encode state"))
    }
}

/// Struct to hold account's information
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Debug, Clone, Eq, PartialEq)]
pub struct AccountInfo {
    pub hash: String,
    pub nonce: u128,
}

/// The state of the contract, that is totally serialized on-chain
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Debug, Clone)]
pub struct Wallet {
    identities: BTreeMap<String, AccountInfo>,
}

/// Enum representing the actions that can be performed by the IdentityVerification contract.
#[derive(Serialize, Deserialize, BorshSerialize, BorshDeserialize, Debug, Clone)]
pub enum WalletAction {
    RegisterIdentity { account: String, nonce: u128 },
    VerifyIdentity { account: String, nonce: u128 },
}

/// Some helper methods for the state
impl Wallet {
    pub fn new() -> Self {
        Wallet {
            identities: BTreeMap::new(),
        }
    }

    pub fn get_nonce(&self, username: &str) -> Result<u128, &'static str> {
        let info = self.identities.get(username).ok_or("Identity not found")?;
        Ok(info.nonce)
    }

    pub fn as_bytes(&self) -> Result<Vec<u8>, Error> {
        borsh::to_vec(self)
    }
}

impl Wallet {
    pub fn build_identity_id(account: &str, password: &str) -> Vec<u8> {
        // hash password
        let mut hasher = Sha256::new();
        hasher.update(password.as_bytes());
        let hashed_password = hasher.finalize();
        let hashed_password = hashed_password.as_slice();

        let id = format!("{:0<64}:", account);
        let mut id = id.as_bytes().to_vec();
        id.extend_from_slice(hashed_password);

        let mut hasher = Sha256::new();
        hasher.update(id);
        let hash_bytes = hasher.finalize();

        hash_bytes.to_vec()
    }

    fn register_identity(
        &mut self,
        account: String,
        nonce: u128,
        hash: String,
    ) -> Result<String, String> {
        let account_info = AccountInfo { hash, nonce };

        if self.identities.insert(account, account_info).is_some() {
            return Err("Identity already exists".to_string());
        }
        Ok("Successfully registered identity for account: {}".to_string())
    }

    fn verify_identity(
        &mut self,
        account: String,
        nonce: u128,
        hash: String,
    ) -> Result<String, String> {
        match self.identities.get_mut(&account) {
            Some(stored_info) => {
                if nonce != stored_info.nonce {
                    return Err("Invalid nonce".to_string());
                }
                if hash != stored_info.hash {
                    return Err("Invalid hash (wrong secret check)".to_string());
                }
                stored_info.nonce += 1;
                Ok("Identity verified".to_string())
            }
            None => Err("Identity not found".to_string()),
        }
    }
}

impl Default for Wallet {
    fn default() -> Self {
        Self::new()
    }
}

/// Helpers to transform the contrat's state in its on-chain state digest version.
/// In an optimal version, you would here only returns a hash of the state,
/// while storing the full-state off-chain
impl From<sdk::StateCommitment> for Wallet {
    fn from(state: sdk::StateCommitment) -> Self {
        borsh::from_slice(&state.0)
            .map_err(|_| "Could not decode identity state".to_string())
            .unwrap()
    }
}
