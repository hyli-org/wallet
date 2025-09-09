use std::{str::FromStr, vec};

use borsh::{io::Error, BorshDeserialize, BorshSerialize};
#[cfg(feature = "client")]
use client_sdk::contract_indexer::utoipa;
use jsonwebtoken::Algorithm;
use sdk::{
    hyli_model_utils::TimestampMs,
    merkle_utils::{BorshableMerkleProof, SHA256Hasher},
    secp256k1::CheckSecp256k1,
    ContractName, LaneId, RunResult, StateCommitment,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sparse_merkle_tree::{traits::Value, H256};

#[cfg(feature = "client")]
pub mod client;
pub mod smt;

pub type InviteCodePubKey = [u8; 33];
pub const DEFAULT_INVITE_CODE_PUBLIC_KEY: InviteCodePubKey = [
    2, 82, 222, 37, 58, 251, 184, 56, 112, 182, 255, 255, 252, 221, 235, 53, 107, 2, 98, 178, 4,
    234, 13, 218, 118, 136, 8, 202, 95, 190, 184, 177, 226,
];

fn get_state_commitment(root: H256, pubkey: InviteCodePubKey) -> StateCommitment {
    let mut hasher = Sha256::new();
    hasher.update(root.as_slice());
    hasher.update(pubkey);
    let result = hasher.finalize();
    StateCommitment(result.to_vec())
}

impl sdk::TransactionalZkContract for WalletZkView {
    type State = sdk::StateCommitment;

    fn initial_state(&self) -> Self::State {
        self.commitment.clone()
    }

    fn revert(&mut self, initial_state: Self::State) {
        self.commitment = initial_state;
    }
}

impl sdk::ZkContract for WalletZkView {
    fn execute(&mut self, calldata: &sdk::Calldata) -> RunResult {
        let (action, ctx) = sdk::utils::parse_raw_calldata::<WalletAction>(calldata)?;

        if let WalletAction::UpdateInviteCodePublicKey {
            invite_code_public_key,
            smt_root,
            ..
        } = action
        {
            // Source of trust is trust me bro for this one.
            if self.invite_code_public_key != DEFAULT_INVITE_CODE_PUBLIC_KEY {
                return Err("Invite code public key already set".to_string());
            }
            self.invite_code_public_key = invite_code_public_key;
            self.commitment = get_state_commitment(H256::from(smt_root), invite_code_public_key);
            return Ok(("Updated public key".as_bytes().to_vec(), ctx, vec![]));
        }

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

        // Validate internal consistency, then check hash.
        let root = proof
            .0
            .clone()
            .compute_root::<SHA256Hasher>(leaves.clone())
            .expect("Failed to compute root from proof");
        let verified = proof
            .0
            .clone()
            .verify::<SHA256Hasher>(&root, leaves.clone())
            .map_err(|e| format!("Failed to verify proof: {e}"))?;
        if self.commitment != get_state_commitment(root, self.invite_code_public_key) {
            panic!(
                "State commitment mismatch: expected {:?}, got {:?}",
                self.commitment,
                get_state_commitment(root, self.invite_code_public_key)
            );
        }

        if !verified {
            // Proof is invalid and we must panic.
            panic!("Proof verification failed for the contract state",);
        }

        let res = match action {
            WalletAction::RegisterIdentity {
                account,
                nonce,
                auth_method,
                jwt,
                invite_code,
                salt: _,
            } => {
                check_for_invite_code(
                    &account,
                    &invite_code,
                    calldata,
                    &self.invite_code_public_key,
                )?;
                account_info.handle_registration(account, nonce, auth_method, calldata, jwt)?
            }
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

        self.commitment = get_state_commitment(new_root, self.invite_code_public_key);

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
    pub invite_code_public_key: InviteCodePubKey,
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
        hash: String, // Salted hash of the password
    },
    // Jwt token from external providers
    Jwt,
    // Special "0" value to indicate uninitialized wallet - second for retrocomp
    #[default]
    Uninitialized,
    // Other authentication methods can be added here
}

impl AuthMethod {
    // Verifies the authentication method during use
    fn verify(
        &self,
        calldata: &sdk::Calldata,
        nonce: u128,
        jwt: Option<JsonWebToken>,
    ) -> Result<String, String> {
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
                        "Invalid authentication, expected {hash}, got {checked_hash}"
                    ));
                }
                Ok("Authentication successful".to_string())
            }
            AuthMethod::Jwt => {
                let token = jwt.ok_or("Missing JWT authentication".to_string())?;

                // In a real implementation, you would verify the JWT token here.
                // For simplicity, we'll just check if the token is non-empty.
                if !token.is_valid() {
                    return Err("Invalid JWT authentication".to_string());
                }

                let infos = token.extract_infos()?;

                // Get contract name from calldata
                let contract_name = calldata
                    .blobs
                    .iter()
                    .find(|(index, _)| index == &calldata.index)
                    .map(|(_, b)| b.contract_name.0.clone())
                    .ok_or("Missing contract blob")?;

                if format!("{}@{contract_name}", infos.email) != calldata.identity.0 {
                    return Err(format!(
                        "JWT token email does not match identity {}@{contract_name} != {}",
                        infos.email, calldata.identity.0,
                    ));
                }

                if nonce <= infos.nonce_as_u128().unwrap_or(0) {
                    return Err(format!(
                        "JWT token nonce does not match {} != {:?}",
                        nonce, infos.nonce
                    ));
                }

                Ok(format!(
                    "JWT authentication successful for email: {}",
                    infos.email
                ))
            }
        }
    }
}

#[allow(dead_code, unused)]
fn check_for_invite_code(
    account: &String,
    invite_code: &String,
    calldata: &sdk::Calldata,
    invite_code_public_key: &InviteCodePubKey,
) -> Result<(), String> {
    #[cfg(test)]
    {
        if invite_code == "test_invite_code" {
            return Ok(());
        }
        return Err("Invalid invite code for testing".to_string());
    }
    // Data to sign: "Invite - {invite_code} for {account}"
    let data = format!("Invite - {invite_code} for {account}");
    // Check if the calldata contains a secp256k1 blob with the expected data
    let blob = CheckSecp256k1::new(calldata, data.as_bytes()).expect()?;
    if blob.public_key != *invite_code_public_key {
        return Err("Invalid public key".to_string());
    }
    Ok(())
}

/// Methods to handle the actions of the Wallet contract
impl AccountInfo {
    fn handle_registration(
        &mut self,
        account: String,
        nonce: u128,
        auth_method: AuthMethod,
        calldata: &sdk::Calldata,
        jwt: Option<JsonWebToken>,
    ) -> Result<String, String> {
        auth_method.verify(calldata, nonce, jwt)?;
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
        match action {
            WalletAction::VerifyIdentity {
                account,
                nonce,
                jwt,
            } => {
                self.auth_method.verify(calldata, nonce, jwt)?;

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
                jwt,
                nonce,
            } => {
                self.auth_method.verify(calldata, nonce, jwt)?;

                if self.identity != account {
                    return Err("Account does not match registered identity".to_string());
                }
                self.add_session_key(key, expiration_date, whitelist, lane_id)
            }
            WalletAction::RemoveSessionKey {
                key, jwt, nonce, ..
            } => {
                self.auth_method.verify(calldata, nonce, jwt)?;

                self.remove_session_key(key)
            }
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

#[serde_with::serde_as]
#[derive(Serialize, Deserialize, BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct JsonWebToken {
    // The JWT token string, split in 3 parts by '.' (HEADER.PAYLOAD.SIGNATURE)
    pub token: String,
    // The client ID (audience) for which the token is valid
    pub client_id: String,
    // The algorithm used to sign the token, e.g. "RS256"
    pub algorithm: String,
    // The RSA infos (modulus, exponent) of the provider to verify the token signature
    pub provider_rsa_infos: Option<[String; 2]>, // (modulus, exponent)
}

#[derive(Serialize, Deserialize, BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct JsonWebTokenExtractedInfo {
    pub email: String,
    pub nonce: Option<String>,
}

impl JsonWebTokenExtractedInfo {
    pub fn nonce_as_u128(&self) -> Option<u128> {
        self.nonce.as_ref().and_then(|n| n.parse::<u128>().ok())
    }
}

impl JsonWebToken {
    pub fn is_valid(&self) -> bool {
        !self.token.is_empty() && !self.algorithm.is_empty()
    }
    pub fn extract_infos(&self) -> Result<JsonWebTokenExtractedInfo, String> {
        dbg!(&self);
        let alg = Algorithm::from_str(self.algorithm.as_str()).map_err(|e| {
            format!(
                "Failed to parse algorithm from string {}: {}",
                self.algorithm, e
            )
        })?;

        let decoding_key = if alg == Algorithm::RS256 {
            if let Some([modulus, exponent]) = &self.provider_rsa_infos {
                jsonwebtoken::DecodingKey::from_rsa_components(modulus.as_str(), exponent.as_str())
                    .map_err(|err| format!("Wrong rsa format {err}"))?
            } else {
                return Err("Missing RSA infos for provider".to_string());
            }
        } else {
            return Err(format!("Unsupported algorithm: {}", self.algorithm));
        };

        let mut validation = jsonwebtoken::Validation::new(alg);
        validation.validate_exp = false; // We don't care about expiration for now
        validation.set_audience(&[self.client_id.as_str()]);

        jsonwebtoken::decode::<JsonWebTokenExtractedInfo>(&self.token, &decoding_key, &validation)
            .map_err(|e| format!("Failed to decode JWT token: {}", e))
            .map(|data| data.claims)
    }
}

/// Enum representing the actions that can be performed by the IdentityVerification contract.
#[serde_with::serde_as]
#[derive(Serialize, Deserialize, BorshSerialize, BorshDeserialize, Debug, Clone)]
pub enum WalletAction {
    RegisterIdentity {
        account: String,
        nonce: u128,
        salt: String, // Not actually used in the circuit, provided as DA
        auth_method: AuthMethod,
        invite_code: String,
        jwt: Option<JsonWebToken>,
    },
    VerifyIdentity {
        account: String,
        nonce: u128,
        jwt: Option<JsonWebToken>,
    },
    AddSessionKey {
        account: String,
        key: String,
        expiration_date: u128,
        whitelist: Option<Vec<ContractName>>,
        lane_id: Option<LaneId>,
        nonce: u128,
        jwt: Option<JsonWebToken>,
    },
    RemoveSessionKey {
        account: String,
        key: String,
        nonce: u128,
        jwt: Option<JsonWebToken>,
    },
    UseSessionKey {
        account: String,
        nonce: u128,
    },
    // Last for binary compatibility
    UpdateInviteCodePublicKey {
        #[serde_as(as = "[_; 33]")]
        invite_code_public_key: InviteCodePubKey,
        smt_root: [u8; 32],
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

    pub fn jwt_and_nonce(&self) -> Option<(&Option<JsonWebToken>, u128)> {
        match self {
            WalletAction::RegisterIdentity { jwt, nonce, .. } => Some((jwt, *nonce)),
            WalletAction::VerifyIdentity { jwt, nonce, .. } => Some((jwt, *nonce)),
            WalletAction::AddSessionKey { jwt, nonce, .. } => Some((jwt, *nonce)),
            WalletAction::RemoveSessionKey { jwt, nonce, .. } => Some((jwt, *nonce)),
            WalletAction::UpdateInviteCodePublicKey { .. } => None,
            WalletAction::UseSessionKey { .. } => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::client::tx_executor_handler::Wallet;

    use super::*;
    use client_sdk::transaction_builder::TxExecutorHandler;
    use sdk::{Blob, BlobIndex, Calldata, Identity, IndexedBlobs};

    #[test]
    fn test_wallet_logic() {
        let mut wallet = Wallet::new(&ContractName::new("test"), &None).unwrap();

        let password_hash = "test_hash".to_string().into_bytes();
        let hex_encoded_hash = hex::encode(password_hash.clone());

        let ho = wallet
            .handle(&Calldata {
                blobs: IndexedBlobs::from(vec![
                    WalletAction::RegisterIdentity {
                        account: "test_account".to_string(),
                        nonce: 1,
                        salt: "test_salt".to_string(),
                        auth_method: AuthMethod::Password {
                            hash: hex_encoded_hash.clone(),
                        },
                        invite_code: "test_invite_code".to_string(),
                        jwt: None,
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
                        salt: "test_salt".to_string(),
                        auth_method: AuthMethod::Password {
                            hash: hex_encoded_hash.clone(),
                        },
                        invite_code: "test_invite_code".to_string(),
                        jwt: None,
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
                        jwt: None,
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
                        jwt: None,
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
                        jwt: None,
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
                        salt: "test_salt".to_string(),
                        auth_method: AuthMethod::Password {
                            hash: hex_encoded_hash.clone(),
                        },
                        invite_code: "test_invite_code".to_string(),
                        jwt: None,
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
            salt: "test_salt".to_string(),
            auth_method: AuthMethod::Password {
                hash: hex_encoded_hash.clone(),
            },
            invite_code: "test_invite_code".to_string(),
            jwt: None,
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

        let mut wallet = Wallet::new(&ContractName::new("test"), &None).unwrap();
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
                    jwt: None,
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
                        jwt: None,
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
            salt: "test_salt".to_string(),
            auth_method: AuthMethod::Password {
                hash: hex_encoded_hash.clone(),
            },
            invite_code: "test_invite_code".to_string(),
            jwt: None,
        }
        .as_blob(sdk::ContractName("wallet".to_string()));
        let identity_blob = WalletAction::VerifyIdentity {
            account: "test_account".to_string(),
            nonce: 2,
            jwt: None,
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

        let mut wallet = Wallet::new(&ContractName::new("test"), &None).unwrap();
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

    #[test]
    fn test_merkle_invite_code() {
        let password_hash = "test_hash".to_string().into_bytes();
        let hex_encoded_hash = hex::encode(password_hash.clone());

        let change_invite_code_public_key = WalletAction::UpdateInviteCodePublicKey {
            invite_code_public_key: [4; 33],
            smt_root: [0; 32],
        };
        let pubkey_blob =
            change_invite_code_public_key.as_blob(sdk::ContractName("wallet".to_string()));
        let register_blob = WalletAction::RegisterIdentity {
            account: "test_account".to_string(),
            nonce: 1,
            salt: "test_salt".to_string(),
            auth_method: AuthMethod::Password {
                hash: hex_encoded_hash.clone(),
            },
            invite_code: "test_invite_code".to_string(),
            jwt: None,
        }
        .as_blob(sdk::ContractName("wallet".to_string()));
        let blobs = IndexedBlobs::from(vec![
            pubkey_blob.clone(),
            register_blob.clone(),
            Blob {
                contract_name: sdk::ContractName("check_secret".to_string()),
                data: sdk::BlobData(password_hash.clone()),
            },
        ]);
        let pubkey_call = &Calldata {
            blobs: blobs.clone(),
            index: BlobIndex(0),
            ..Default::default()
        };
        let register_call = &Calldata {
            blobs: blobs.clone(),
            index: BlobIndex(1),
            ..Default::default()
        };

        let mut wallet = Wallet::new(&ContractName::new("test"), &None).unwrap();
        {
            let v = wallet.build_commitment_metadata(&pubkey_blob).unwrap();
            let mut zk_view: WalletZkView = borsh::from_slice(&v).unwrap();

            zk_view.execute(&pubkey_call.clone()).unwrap();
            wallet.handle(pubkey_call).unwrap();
            assert_eq!(
                zk_view.invite_code_public_key, [4; 33],
                "Public key should be updated"
            );
            assert_eq!(zk_view.commitment, wallet.get_state_commitment());
        }
        {
            let v = wallet.build_commitment_metadata(&register_blob).unwrap();
            let mut zk_view: WalletZkView = borsh::from_slice(&v).unwrap();

            zk_view.execute(&register_call.clone()).unwrap();
            wallet.handle(register_call).unwrap();
            wallet
                .get(&"test_account".to_string())
                .expect("Account should be registered");
        }
    }

    #[test]
    #[should_panic(expected = "State commitment mismatch")]
    fn test_bad_merkle() {
        let password_hash = "test_hash".to_string().into_bytes();
        let hex_encoded_hash = hex::encode(password_hash.clone());

        let register_blob = WalletAction::RegisterIdentity {
            account: "test_account".to_string(),
            nonce: 1,
            salt: "test_salt".to_string(),
            auth_method: AuthMethod::Password {
                hash: hex_encoded_hash.clone(),
            },
            invite_code: "test_invite_code".to_string(),
            jwt: None,
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

        let mut wallet = Wallet::new(&ContractName::new("test"), &None).unwrap();
        let v = wallet
            .build_commitment_metadata(&register_blob)
            .expect("Failed to build commitment metadata");

        let mut zk_view: WalletZkView =
            borsh::from_slice(&v).expect("Failed to deserialize zk view");
        zk_view.commitment = StateCommitment(vec![4; 32]); // Force a bad commitment
        assert_eq!(zk_view.partial_data.len(), 1);
        zk_view
            .execute(&register_call.clone())
            .expect("Failed to execute zk view");
        wallet
            .handle(register_call)
            .expect("Failed to handle register call");
    }

    #[test]
    fn test_google_auth() {
        /*
        {
          "keys": [
            {
              "alg": "RS256",
              "kty": "RSA",
              "n": "v85Io5Rp7vwbSlkuAowWVcfUxZdPckijmLAZ3WEl3nTUTkz9YfmKJUiqdZMRuJxL50F3TRBKDxvfFbWX602sPTShoK6H2pdbQNrKsGV_KIlLLsIkcVnG-KNuY-ZnkZ9ppCH9yqjGw08imHlLsIngSK8VF03nCwUiv_VtZ27FltUttRxkoZGxCYX0-MRicIXPNKILml-xmknGNLsDCvAYqhbg3tZRKi1dZuHLhCb_YTov5YhprvVzm5OagvrvZuia_qilk-ctgqRJRPFGrVm75gkV4WdwxQQukCPqf5UfIopdOAB4wBdovddX3jjpjphq8-gKMPO-t_6siCt1xETSOQ",
              "e": "AQAB",
              "kid": "2d7ed338c0f1457b214a274b5e0e667b44a42dde",
              "use": "sig"
            },
            {
              "n": "6GmQd18e3fKydx1Zg0mqWvk8qP1Zp5ahfvM5x1fD7-5NBz5J7NGy1mwvIzyEMukA9zrV5ib2F476_FsAD0LkdDPOuv3F8qU9y48J6JGEHZBxXm5Q-1FN4LABsU3hOtXgcrIHicrvGu40eippOCWinA5BIsCtobNsgl990yD96iyWJvAEVLrBM03l3eSWQbvo3YYgale5Bsy-_-BYQM-CfHoaxVpYUjXm8G9I0z3GBv5uytu6vUR9KSyOk07NTLcInzGV7Xpbv0WftvcqP4gG-h5bvg67mx2pBwSiJtQR5n0BTd4Gtx8R6EqAhX08oOdFDZSLQJ8jZqoG6psGtMfePw",
              "e": "AQAB",
              "use": "sig",
              "alg": "RS256",
              "kty": "RSA",
              "kid": "9c6251587950844a656be3563d8c5bd6f894c407"
            }
          ]
        }
                 */

        let token ="eyJhbGciOiJSUzI1NiIsImtpZCI6IjJkN2VkMzM4YzBmMTQ1N2IyMTRhMjc0YjVlMGU2NjdiNDRhNDJkZGUiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhenAiOiI0MTEwMDY0NDQ3ODMtNGtuZWk2NzF1Y3FmbzIycHM5dWM1dHBqMTFkdmlhdjcuYXBwcy5nb29nbGV1c2VyY29udGVudC5jb20iLCJhdWQiOiI0MTEwMDY0NDQ3ODMtNGtuZWk2NzF1Y3FmbzIycHM5dWM1dHBqMTFkdmlhdjcuYXBwcy5nb29nbGV1c2VyY29udGVudC5jb20iLCJzdWIiOiIxMDM4NTIyMDE2MDk1Mzc2MTg3NzAiLCJoZCI6Imh5bGUuZXUiLCJlbWFpbCI6ImFsZXhhbmRyZUBoeWxlLmV1IiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5vbmNlIjoiMCIsIm5iZiI6MTc1Njk4Nzc0NywibmFtZSI6IkFsZXhhbmRyZSBDYXJlaWwiLCJwaWN0dXJlIjoiaHR0cHM6Ly9saDMuZ29vZ2xldXNlcmNvbnRlbnQuY29tL2EvQUNnOG9jTGJyT040ZjdaUWlZZXJwRU5fcWNCdElBUVRPWHdtQ25KSERwUmtxSlJOYm1vbEJ3PXM5Ni1jIiwiZ2l2ZW5fbmFtZSI6IkFsZXhhbmRyZSIsImZhbWlseV9uYW1lIjoiQ2FyZWlsIiwiaWF0IjoxNzU2OTg4MDQ3LCJleHAiOjE3NTY5OTE2NDcsImp0aSI6ImZlYzUxYjcyNDc5NDFhYzEwMzFiZTlkYzY1ZjlkMDJlZDY0MTdkNDgifQ.S1F8PvJcbT2muJJvXsf1Pm59Suj5LZtnPf_LYg63KlMI6YNgr91CMWunLLBbSXJiyDosaSXuM671uEsPQdMTvzN7grck68c7fkHWYy6QyVTcB6iViMp4BolPhp9Nxb28AUN82BH8rmIhjM4Zi6d46xSFwkcA-qhhOsSb6ZWlVtgwvGHDwwBewE7hw0FUISJxUagptyHbq_riuAR1O_-acix_9SfK0ulm9hGy8ExpWxrATD9l-l8SkwmnkfzUquh2Lgt1ggbTYtrH2a5cvEyMS2NPQ61w7BPL9LjfphkOZ3GKqfOD-pXUaxNgr4RFItQ0O7mxJgJjcRll-xGTvJkICg";
        let pubkey = "v85Io5Rp7vwbSlkuAowWVcfUxZdPckijmLAZ3WEl3nTUTkz9YfmKJUiqdZMRuJxL50F3TRBKDxvfFbWX602sPTShoK6H2pdbQNrKsGV_KIlLLsIkcVnG-KNuY-ZnkZ9ppCH9yqjGw08imHlLsIngSK8VF03nCwUiv_VtZ27FltUttRxkoZGxCYX0-MRicIXPNKILml-xmknGNLsDCvAYqhbg3tZRKi1dZuHLhCb_YTov5YhprvVzm5OagvrvZuia_qilk-ctgqRJRPFGrVm75gkV4WdwxQQukCPqf5UfIopdOAB4wBdovddX3jjpjphq8-gKMPO-t_6siCt1xETSOQ";

        let register_blob = WalletAction::RegisterIdentity {
            account: "test_account".to_string(),
            nonce: 0,
            salt: "test_salt".to_string(),
            auth_method: AuthMethod::Jwt,
            invite_code: "test_invite_code".to_string(),
            jwt: Some(JsonWebToken {
                token: token.to_string(),
                client_id:
                    "411006444783-4knei671ucqfo22ps9uc5tpj11dviav7.apps.googleusercontent.com"
                        .to_string(),
                algorithm: "RS256".to_string(),
                provider_rsa_infos: Some([pubkey.to_string(), "AQAB".to_string()]),
            }),
        }
        .as_blob(sdk::ContractName("wallet".to_string()));

        let register_call = &Calldata {
            identity: Identity("alexandre@hyle.eu@wallet".to_string()),
            blobs: IndexedBlobs::from(vec![register_blob.clone()]),
            index: BlobIndex(0),
            ..Default::default()
        };

        let mut wallet = Wallet::new(&ContractName::new("test"), &None).unwrap();
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
            .handle(&register_call)
            .expect("Failed to handle register call");
    }
}
