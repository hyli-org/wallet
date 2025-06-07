use borsh::{io::Error, BorshDeserialize, BorshSerialize};
#[cfg(feature = "client")]
use client_sdk::contract_indexer::utoipa;
use sdk::{
    hyle_model_utils::TimestampMs,
    merkle_utils::{BorshableMerkleProof, SHA256Hasher},
    secp256k1::CheckSecp256k1,
    ContractName, LaneId, RunResult, StateCommitment,
};
use serde::{Deserialize, Serialize};
use sparse_merkle_tree::traits::Value;

#[cfg(feature = "client")]
pub mod client;
pub mod smt;

impl sdk::ZkContract for WalletZkView {
    fn execute(&mut self, calldata: &sdk::Calldata) -> RunResult {
        let (action, ctx) = sdk::utils::parse_raw_calldata::<WalletAction>(calldata)?;

        // If we don't have state for this calldata, then the proof cannot be generated and we must panic.
        let PartialWalletData {
            proof,
            mut account_info,
        } = self
            .partial_data
            .pop()
            .expect("No partial data available for the contract state");

        let account_key = AccountInfo::compute_key(&account_info.identity);
        let leaves = vec![(account_key, account_info.to_h256())];

        let verified = proof
            .0
            .clone()
            .verify::<SHA256Hasher>(
                &TryInto::<[u8; 32]>::try_into(self.commitment.0.clone())
                    .unwrap()
                    .into(),
                leaves.clone(),
            )
            .map_err(|e| format!("Failed to verify proof: {}", e))?;

        if !verified {
            // Proof is invalid and we must panic.
            panic!("Proof verification failed for the contract state",);
        }

        let res = match action {
            WalletAction::RegisterIdentity {
                account,
                nonce,
                auth_method,
            } => account_info.handle_registration(account, nonce, auth_method, calldata)?,
            WalletAction::UseSessionKey { account, nonce } => {
                account_info.handle_session_key_usage(account, nonce, calldata)?
            }
            _ => account_info.handle_authenticated_action(action, calldata)?,
        };

        // Now update the commitment
        let leaves = vec![(account_key, account_info.to_h256())];
        let new_root = proof
            .0
            .compute_root::<SHA256Hasher>(leaves)
            .expect("Failed to compute new root");

        self.commitment = StateCommitment(Into::<[u8; 32]>::into(new_root).to_vec());

        Ok((res.into_bytes(), ctx, vec![]))
    }

    /// In this example, we serialize the full state on-chain.
    fn commit(&self) -> sdk::StateCommitment {
        self.commitment.clone()
    }
}

/// Partial state of the Wallet contract, for proof generation and verification
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct WalletZkView {
    pub commitment: sdk::StateCommitment,
    pub partial_data: Vec<PartialWalletData>,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct PartialWalletData {
    pub proof: BorshableMerkleProof,
    pub account_info: AccountInfo,
}

/// Struct to hold account's information
#[derive(
    BorshSerialize, BorshDeserialize, Serialize, Deserialize, Debug, Default, Clone, Eq, PartialEq,
)]
#[cfg_attr(
    feature = "client",
    derive(client_sdk::contract_indexer::utoipa::ToSchema)
)]
pub struct AccountInfo {
    // The identity field is the key in the merkle tree too.
    pub identity: String,

    pub auth_method: AuthMethod,
    pub session_keys: Vec<SessionKey>,
    pub nonce: u128,
}

#[derive(
    BorshSerialize, BorshDeserialize, Serialize, Deserialize, Debug, Default, Clone, Eq, PartialEq,
)]
#[cfg_attr(
    feature = "client",
    derive(client_sdk::contract_indexer::utoipa::ToSchema)
)]
pub struct SessionKey {
    pub public_key: String,
    pub expiration_date: TimestampMs,
    pub nonce: u128,
    pub whitelist: Option<Vec<ContractName>>,
    pub lane_id: Option<LaneId>,
}

#[derive(
    BorshSerialize, BorshDeserialize, Serialize, Deserialize, Debug, Default, Clone, Eq, PartialEq,
)]
#[cfg_attr(
    feature = "client",
    derive(client_sdk::contract_indexer::utoipa::ToSchema)
)]
pub enum AuthMethod {
    Password {
        hash: String,
    },
    // Special "0" value to indicate uninitialized wallet - second for retrocomp
    #[default]
    Uninitialized,
    // Other authentication methods can be added here
}

impl AuthMethod {
    // Verifies the authentication method during use
    fn verify(&self, calldata: &sdk::Calldata) -> Result<String, String> {
        match self {
            AuthMethod::Uninitialized => Err("Wallet is not initialized".to_string()),
            AuthMethod::Password { hash } => {
                let check_secret = calldata
                    .blobs
                    .iter()
                    .find(|(_, b)| b.contract_name.0 == "check_secret")
                    .map(|(_, b)| b.data.clone())
                    .ok_or("Missing check_secret blob")?;

                let checked_hash = hex::encode(check_secret.0);
                if checked_hash != *hash {
                    return Err(format!(
                        "Invalid authentication, expected {}, got {}",
                        hash, checked_hash
                    ));
                }
                Ok("Authentication successful".to_string())
            }
        }
    }
}

/// Methods to handle the actions of the Wallet contract
impl AccountInfo {
    fn handle_registration(
        &mut self,
        account: String,
        nonce: u128,
        auth_method: AuthMethod,
        calldata: &sdk::Calldata,
    ) -> Result<String, String> {
        auth_method.verify(calldata)?;
        self.register_identity(account, nonce, auth_method)
    }

    fn handle_session_key_usage(
        &mut self,
        account: String,
        nonce: u128,
        calldata: &sdk::Calldata,
    ) -> Result<String, String> {
        // TODO: think this is now un-necessary, we can just check Identity
        if self.identity != account {
            return Err("Account does not match registered identity".to_string());
        }
        let secp256k1blob = CheckSecp256k1::new(calldata, nonce.to_string().as_bytes()).expect()?;
        let public_key = hex::encode(secp256k1blob.public_key);
        self.use_session_key(public_key, calldata, nonce)
    }

    fn handle_authenticated_action(
        &mut self,
        action: WalletAction,
        calldata: &sdk::Calldata,
    ) -> Result<String, String> {
        // Verify identity before executing the action
        self.auth_method.verify(calldata)?;

        match action {
            WalletAction::VerifyIdentity { nonce, account } => {
                if self.identity != account {
                    return Err("Account does not match registered identity".to_string());
                }
                self.verify_identity(nonce)
            }
            WalletAction::AddSessionKey {
                account,
                key,
                expiration_date,
                whitelist,
                lane_id,
            } => {
                if self.identity != account {
                    return Err("Account does not match registered identity".to_string());
                }
                self.add_session_key(key, expiration_date, whitelist, lane_id)
            }
            WalletAction::RemoveSessionKey { key, .. } => self.remove_session_key(key),
            _ => unreachable!(),
        }
    }
}

/// State management methods for the Wallet contract
impl AccountInfo {
    fn register_identity(
        &mut self,
        account: String,
        nonce: u128,
        auth_method: AuthMethod,
    ) -> Result<String, String> {
        if self.identity != account {
            return Err("Identity already registered".to_string());
        }
        if self.auth_method != AuthMethod::Uninitialized {
            return Err("Identity already registered".to_string());
        }
        let ret = format!("Successfully registered identity for account: {account}");
        self.auth_method = auth_method;
        self.nonce = nonce;
        Ok(ret)
    }

    fn verify_identity(&mut self, nonce: u128) -> Result<String, String> {
        if nonce <= self.nonce {
            return Err("Invalid nonce".to_string());
        }
        self.nonce = nonce;
        Ok("Identity verified".to_string())
    }

    fn add_session_key(
        &mut self,
        key: String,
        expiration_date: u128,
        whitelist: Option<Vec<ContractName>>,
        lane_id: Option<LaneId>,
    ) -> Result<String, String> {
        if self.session_keys.iter().any(|sk| sk.public_key == key) {
            return Err("Session key already exists".to_string());
        }

        self.session_keys.push(SessionKey {
            public_key: key,
            expiration_date: TimestampMs(expiration_date),
            nonce: 0, // Initialize nonce at 0
            whitelist,
            lane_id,
        });
        self.nonce += 1;
        Ok("Session key added".to_string())
    }

    fn remove_session_key(&mut self, key: String) -> Result<String, String> {
        let initial_len = self.session_keys.len();
        self.session_keys.retain(|sk| sk.public_key != key);

        if self.session_keys.len() == initial_len {
            return Err("Session key not found".to_string());
        }

        self.nonce += 1;
        Ok("Session key removed".to_string())
    }

    fn use_session_key(
        &mut self,
        public_key: String,
        calldata: &sdk::Calldata,
        nonce: u128,
    ) -> Result<String, String> {
        let Some(tx_ctx) = &calldata.tx_ctx else {
            return Err("tx_ctx is missing".to_string());
        };
        // Check that all blobs of the transaction are in the Calldata
        if calldata.blobs.len() != calldata.tx_blob_count {
            return Err("All blobs should be in the Calldata for whitelist validation".to_string());
        }

        if let Some(session_key) = self
            .session_keys
            .iter_mut()
            .find(|sk| sk.public_key == public_key)
        {
            // Check if all blobs in the transaction context are whitelisted
            for (index, blob) in &calldata.blobs {
                if index == &calldata.index {
                    continue; // Skip the blob for this contract
                }
                if blob.contract_name.0 == "secp256k1" {
                    continue; // Skip the secp256k1 blob
                }
                if let Some(ref whitelist) = session_key.whitelist {
                    if !whitelist.contains(&blob.contract_name) {
                        return Err(format!("Blob: {} not whitelisted", blob.contract_name.0));
                    }
                }
            }
            if session_key.lane_id.is_some()
                && session_key.lane_id.as_ref() != Some(&tx_ctx.lane_id)
            {
                return Err("Session key not valid for this lane".to_string());
            }
            if session_key.expiration_date > tx_ctx.timestamp {
                session_key.nonce = nonce;
                return Ok("Session key is valid".to_string());
            } else {
                return Err("Session key expired".to_string());
            }
        }
        Err("Session key not found".to_string())
    }
}

/// Some helper methods for the state
impl WalletZkView {
    pub fn as_bytes(&self) -> Result<Vec<u8>, Error> {
        borsh::to_vec(self)
    }
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
        whitelist: Option<Vec<ContractName>>,
        lane_id: Option<LaneId>,
    },
    RemoveSessionKey {
        account: String,
        key: String,
    },
    UseSessionKey {
        account: String,
        nonce: u128,
    },
}

impl WalletAction {
    pub fn as_blob(&self, contract_name: sdk::ContractName) -> sdk::Blob {
        sdk::Blob {
            contract_name,
            data: sdk::BlobData(borsh::to_vec(self).expect("Failed to encode WalletAction")),
        }
    }

    pub fn from_blob_data(blob_data: &sdk::BlobData) -> anyhow::Result<Self> {
        borsh::from_slice(&blob_data.0).map_err(|e| {
            anyhow::anyhow!(
                "Failed to decode WalletAction from blob data: {}",
                e.to_string()
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::client::tx_executor_handler::Wallet;

    use super::*;
    use client_sdk::transaction_builder::TxExecutorHandler;
    use sdk::{Blob, BlobIndex, Calldata, IndexedBlobs};

    #[test]
    fn test_wallet_logic() {
        let mut wallet = Wallet::default();

        let password_hash = "test_hash".to_string().into_bytes();
        let hex_encoded_hash = hex::encode(password_hash.clone());

        let ho = wallet
            .handle(&Calldata {
                blobs: IndexedBlobs::from(vec![
                    WalletAction::RegisterIdentity {
                        account: "test_account".to_string(),
                        nonce: 1,
                        auth_method: AuthMethod::Password {
                            hash: hex_encoded_hash.clone(),
                        },
                    }
                    .as_blob(sdk::ContractName("wallet".to_string())),
                    Blob {
                        contract_name: sdk::ContractName("check_secret".to_string()),
                        data: sdk::BlobData(password_hash.clone()),
                    },
                ]),
                index: BlobIndex(0),
                ..Default::default()
            })
            .expect("Register account");
        assert!(ho.success);

        let ho = wallet
            .handle(&Calldata {
                blobs: IndexedBlobs::from(vec![
                    WalletAction::RegisterIdentity {
                        account: "test_account2".to_string(),
                        nonce: 1,
                        auth_method: AuthMethod::Password {
                            hash: hex_encoded_hash.clone(),
                        },
                    }
                    .as_blob(sdk::ContractName("wallet".to_string())),
                    Blob {
                        contract_name: sdk::ContractName("check_secret".to_string()),
                        data: sdk::BlobData(password_hash.clone()),
                    },
                ]),
                index: BlobIndex(0),
                ..Default::default()
            })
            .expect("Register account");
        assert!(ho.success);

        let ho = wallet
            .handle(&Calldata {
                blobs: IndexedBlobs::from(vec![
                    WalletAction::VerifyIdentity {
                        account: "test_account2".to_string(),
                        nonce: 2,
                    }
                    .as_blob(sdk::ContractName("wallet".to_string())),
                    Blob {
                        contract_name: sdk::ContractName("check_secret".to_string()),
                        data: sdk::BlobData(password_hash.clone()),
                    },
                ]),
                index: BlobIndex(0),
                ..Default::default()
            })
            .expect("Verify account");
        assert!(ho.success);

        let ho = wallet
            .handle(&Calldata {
                blobs: IndexedBlobs::from(vec![
                    WalletAction::VerifyIdentity {
                        account: "test_account2".to_string(),
                        nonce: 3,
                    }
                    .as_blob(sdk::ContractName("wallet".to_string())),
                    Blob {
                        contract_name: sdk::ContractName("check_secret".to_string()),
                        data: sdk::BlobData(password_hash.clone()),
                    },
                ]),
                index: BlobIndex(0),
                ..Default::default()
            })
            .expect("Verify account");
        assert!(ho.success);

        let ho = wallet
            .handle(&Calldata {
                blobs: IndexedBlobs::from(vec![
                    WalletAction::VerifyIdentity {
                        account: "test_account".to_string(),
                        nonce: 2,
                    }
                    .as_blob(sdk::ContractName("wallet".to_string())),
                    Blob {
                        contract_name: sdk::ContractName("check_secret".to_string()),
                        data: sdk::BlobData(password_hash.clone()),
                    },
                ]),
                index: BlobIndex(0),
                ..Default::default()
            })
            .expect("Verify account");
        assert!(ho.success);

        // Re-register should fail
        let ho = wallet
            .handle(&Calldata {
                blobs: IndexedBlobs::from(vec![
                    WalletAction::RegisterIdentity {
                        account: "test_account2".to_string(),
                        nonce: 1,
                        auth_method: AuthMethod::Password {
                            hash: hex_encoded_hash.clone(),
                        },
                    }
                    .as_blob(sdk::ContractName("wallet".to_string())),
                    Blob {
                        contract_name: sdk::ContractName("check_secret".to_string()),
                        data: sdk::BlobData(password_hash.clone()),
                    },
                ]),
                index: BlobIndex(0),
                ..Default::default()
            })
            .expect("Register account");
        assert!(!ho.success);
    }

    use sdk::ZkContract;

    #[test]
    fn test_merkle() {
        let password_hash = "test_hash".to_string().into_bytes();
        let hex_encoded_hash = hex::encode(password_hash.clone());

        let register_blob = WalletAction::RegisterIdentity {
            account: "test_account".to_string(),
            nonce: 1,
            auth_method: AuthMethod::Password {
                hash: hex_encoded_hash.clone(),
            },
        }
        .as_blob(sdk::ContractName("wallet".to_string()));
        let register_call = &Calldata {
            blobs: IndexedBlobs::from(vec![
                register_blob.clone(),
                Blob {
                    contract_name: sdk::ContractName("check_secret".to_string()),
                    data: sdk::BlobData(password_hash.clone()),
                },
            ]),
            index: BlobIndex(0),
            ..Default::default()
        };

        let mut wallet = Wallet::default();
        let v = wallet
            .build_commitment_metadata(&register_blob)
            .expect("Failed to build commitment metadata");
        let mut zk_view: WalletZkView =
            borsh::from_slice(&v).expect("Failed to deserialize zk view");
        assert_eq!(zk_view.partial_data.len(), 1);
        zk_view
            .execute(&register_call.clone())
            .expect("Failed to execute zk view");
        wallet
            .handle(register_call)
            .expect("Failed to handle register call");

        let v = wallet
            .build_commitment_metadata(
                &WalletAction::VerifyIdentity {
                    account: "test_account".to_string(),
                    nonce: 2,
                }
                .as_blob(sdk::ContractName("wallet".to_string())),
            )
            .expect("Failed to build commitment metadata");
        let mut zk_view: WalletZkView =
            borsh::from_slice(&v).expect("Failed to deserialize zk view");
        assert_eq!(zk_view.partial_data.len(), 1);
        zk_view
            .execute(&Calldata {
                blobs: IndexedBlobs::from(vec![
                    WalletAction::VerifyIdentity {
                        account: "test_account".to_string(),
                        nonce: 2,
                    }
                    .as_blob(sdk::ContractName("wallet".to_string())),
                    Blob {
                        contract_name: sdk::ContractName("check_secret".to_string()),
                        data: sdk::BlobData(password_hash.clone()),
                    },
                ]),
                index: BlobIndex(0),
                ..Default::default()
            })
            .expect("Failed to execute zk view");
    }

    #[test]
    fn test_merkle_combined() {
        let password_hash = "test_hash".to_string().into_bytes();
        let hex_encoded_hash = hex::encode(password_hash.clone());

        let register_blob = WalletAction::RegisterIdentity {
            account: "test_account".to_string(),
            nonce: 1,
            auth_method: AuthMethod::Password {
                hash: hex_encoded_hash.clone(),
            },
        }
        .as_blob(sdk::ContractName("wallet".to_string()));
        let identity_blob = WalletAction::VerifyIdentity {
            account: "test_account".to_string(),
            nonce: 2,
        }
        .as_blob(sdk::ContractName("wallet".to_string()));
        let register_call = Calldata {
            blobs: IndexedBlobs::from(vec![
                register_blob.clone(),
                identity_blob.clone(),
                Blob {
                    contract_name: sdk::ContractName("check_secret".to_string()),
                    data: sdk::BlobData(password_hash.clone()),
                },
            ]),
            index: BlobIndex(0),
            ..Default::default()
        };
        let mut verify_call = register_call.clone();
        verify_call.index = BlobIndex(1);

        let mut wallet = Wallet::default();
        let iv = wallet
            .build_commitment_metadata(&register_blob)
            .expect("Failed to build commitment metadata");
        wallet
            .handle(&register_call)
            .expect("Failed to handle register call");
        let nv = wallet
            .build_commitment_metadata(&identity_blob)
            .expect("Failed to build commitment metadata");

        let cv = wallet
            .merge_commitment_metadata(iv, nv)
            .expect("Failed to merge commitment metadata");

        let mut zk_view: WalletZkView =
            borsh::from_slice(&cv).expect("Failed to deserialize zk view");
        assert_eq!(zk_view.partial_data.len(), 2);
        zk_view
            .execute(&register_call.clone())
            .expect("Failed to execute zk view");
        zk_view
            .execute(&verify_call.clone())
            .expect("Failed to execute zk view");
    }
}
