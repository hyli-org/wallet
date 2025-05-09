use std::collections::BTreeMap;

use borsh::{io::Error, BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};

use sdk::{hyle_model_utils::TimestampMs, RunResult, TxContext};

#[cfg(feature = "client")]
pub mod client;

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Debug, Clone, Eq, PartialEq)]
pub enum AuthMethod {
    Password { hash: String },
    // Other authentication methods can be added here
}

impl AuthMethod {
    // Verifies the authentication method during use
    fn verify(&self, calldata: &sdk::Calldata) -> Result<String, String> {
        match self {
            AuthMethod::Password { hash } => {
                let check_secret = calldata
                    .blobs
                    .iter()
                    .find(|(_, b)| b.contract_name.0 == "check_secret")
                    .map(|(_, b)| b.data.clone())
                    .ok_or("Missing check_secret blob")?;

                let checked_hash = hex::encode(check_secret.0);
                if checked_hash != *hash {
                    return Err("Invalid authentication".to_string());
                }
                Ok("Authentication successful".to_string())
            }
        }
    }

    // Verifies prerequisites during registration
    fn verify_registration(&self, _calldata: &sdk::Calldata) -> Result<String, String> {
        match self {
            AuthMethod::Password { .. } => {
                // For Password, no verification needed
                Ok("Password registration verification successful".to_string())
            }
        }
    }
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Debug, Clone, Eq, PartialEq)]
pub struct SessionKey {
    pub key: String,
    pub expiration_date: TimestampMs,
    pub nonce: u128,
}

impl sdk::ZkContract for Wallet {
    fn execute(&mut self, calldata: &sdk::Calldata) -> RunResult {
        let (action, ctx) = sdk::utils::parse_raw_calldata::<WalletAction>(calldata)?;

        let res = match action {
            WalletAction::RegisterIdentity {
                account,
                nonce,
                auth_method,
            } => {
                // First verify the prerequisites for the authentication method
                auth_method.verify_registration(calldata)?;
                self.register_identity(account, nonce, auth_method)?
            }
            _ => {
                // For all other actions, verify identity first
                match &action {
                    WalletAction::UseSessionKey { account, key } => {
                        // Session keys have their own verification logic
                        self.use_session_key(account.clone(), key.clone(), &calldata.tx_ctx)?
                    }
                    _ => {
                        let account = match &action {
                            WalletAction::VerifyIdentity { account, .. } => account,
                            WalletAction::AddSessionKey { account, .. } => account,
                            WalletAction::RemoveSessionKey { account, .. } => account,
                            _ => unreachable!(),
                        };

                        // Verify identity before executing the action
                        let stored_info =
                            self.identities.get(account).ok_or("Identity not found")?;
                        stored_info.auth_method.verify(calldata)?;

                        match action {
                            WalletAction::VerifyIdentity { account, nonce } => {
                                self.verify_identity(account, nonce)?
                            }
                            WalletAction::AddSessionKey {
                                account,
                                key,
                                expiration_date,
                            } => self.add_session_key(account, key, expiration_date)?,
                            WalletAction::RemoveSessionKey { account, key } => {
                                self.remove_session_key(account, key)?
                            }
                            _ => unreachable!(),
                        }
                    }
                }
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
    pub auth_method: AuthMethod,
    pub session_keys: Vec<SessionKey>,
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
    RegisterIdentity {
        account: String,
        nonce: u128,
        auth_method: AuthMethod,
    },
    VerifyIdentity {
        account: String,
        nonce: u128,
    },
    AddSessionKey {
        account: String,
        key: String,
        expiration_date: u128,
    },
    RemoveSessionKey {
        account: String,
        key: String,
    },
    UseSessionKey {
        account: String,
        key: String,
    },
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
    fn register_identity(
        &mut self,
        account: String,
        nonce: u128,
        auth_method: AuthMethod,
    ) -> Result<String, String> {
        let account_info = AccountInfo {
            auth_method,
            session_keys: Vec::new(),
            nonce,
        };

        if self
            .identities
            .insert(account.clone(), account_info)
            .is_some()
        {
            return Err("Identity already exists".to_string());
        }
        Ok(format!(
            "Successfully registered identity for account: {account}"
        ))
    }

    fn verify_identity(&mut self, account: String, nonce: u128) -> Result<String, String> {
        let stored_info = self
            .identities
            .get_mut(&account)
            .ok_or("Identity not found")?;

        if nonce <= stored_info.nonce {
            return Err("Invalid nonce".to_string());
        }

        stored_info.nonce = nonce;
        Ok("Identity verified".to_string())
    }

    fn add_session_key(
        &mut self,
        account: String,
        key: String,
        expiration_date: u128,
    ) -> Result<String, String> {
        let stored_info = self
            .identities
            .get_mut(&account)
            .ok_or("Identity not found")?;

        if stored_info.session_keys.iter().any(|sk| sk.key == key) {
            return Err("Session key already exists".to_string());
        }

        stored_info.session_keys.push(SessionKey {
            key,
            expiration_date: TimestampMs(expiration_date),
            nonce: 0, // Initialize nonce to 0
        });
        stored_info.nonce += 1;
        Ok("Session key added".to_string())
    }

    fn remove_session_key(&mut self, account: String, key: String) -> Result<String, String> {
        let stored_info = self
            .identities
            .get_mut(&account)
            .ok_or("Identity not found")?;

        let initial_len = stored_info.session_keys.len();
        stored_info.session_keys.retain(|sk| sk.key != key);

        if stored_info.session_keys.len() == initial_len {
            return Err("Session key not found".to_string());
        }

        stored_info.nonce += 1;
        Ok("Session key removed".to_string())
    }

    fn use_session_key(
        &mut self,
        account: String,
        key: String,
        tx_ctx: &Option<TxContext>,
    ) -> Result<String, String> {
        let Some(tx_ctx) = tx_ctx else {
            return Err("tx_ctx is missing".to_string());
        };
        match self.identities.get_mut(&account) {
            Some(stored_info) => {
                if let Some(session_key) =
                    stored_info.session_keys.iter_mut().find(|sk| sk.key == key)
                {
                    if session_key.expiration_date < tx_ctx.timestamp {
                        // Increment nonce during use
                        session_key.nonce += 1;
                        return Ok("Session key is valid".to_string());
                    } else {
                        return Err("Session key expired".to_string());
                    }
                }
                Err("Session key not found".to_string())
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
