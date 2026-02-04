use std::vec;

use borsh::{io::Error, BorshDeserialize, BorshSerialize};
#[cfg(feature = "client")]
use client_sdk::contract_indexer::utoipa;
use sdk::{
    hyli_model_utils::TimestampMs,
    merkle_utils::{BorshableMerkleProof, SHA256Hasher},
    secp256k1::CheckSecp256k1,
    verifiers::Secp256k1Blob,
    BlobData, BlobIndex, ContractName, LaneId, RunResult, StateCommitment,
};
use serde::{Deserialize, Serialize};
use sha2::{digest::Digest, Sha256};
use sha3::Keccak256;
use sparse_merkle_tree::{traits::Value, H256};

#[cfg(feature = "client")]
pub mod client;
pub mod smt;
pub mod utils;

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
                invite_code,
                salt: _,
            } => {
                check_for_invite_code(
                    &account,
                    &invite_code,
                    calldata,
                    &self.invite_code_public_key,
                )?;
                account_info.handle_registration(account, nonce, auth_method, calldata)?
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
    Jwt {
        hash: [u8; 32], // Hash of the JWT token email
    },
    Ethereum {
        address: String, // Ethereum public key
    },
    // Special "0" value to indicate uninitialized wallet - second for retrocomp
    #[default]
    Uninitialized,
    // HyliApp authentication (for HyliApp and similar)
    HyliApp {
        address: String, // Hex-encoded address derived from secp256k1 public key
    },
}

impl AuthMethod {
    fn parse_blob_infos(data: &BlobData) -> Result<(&[u8; 32], u128), String> {
        let Some((mail_hash, rest)): Option<(&[u8; 32], &[u8])> = data.0.split_first_chunk() else {
            return Err("Invalid check_jwt blob size".to_string());
        };

        // Skip one byte and take the next 13 bytes of rest that represent the nonce
        let Some((_, rest)) = rest.split_first() else {
            return Err("Invalid check_jwt blob size".to_string());
        };
        let Some((nonce_bytes, _)): Option<(&[u8; 13], &[u8])> = rest.split_first_chunk() else {
            return Err("Invalid check_jwt blob size".to_string());
        };

        // Parse ASCII digits directly without UTF-8 validation
        let mut nonce: u128 = 0;
        for &byte in nonce_bytes {
            if !byte.is_ascii_digit() {
                return Err(format!("Invalid nonce byte: {byte:#x}, expected ASCII digit"));
            }
            nonce = nonce * 10 + (byte - b'0') as u128;
        }

        Ok((mail_hash, nonce))
    }

    // Verifies the authentication method during use
    fn verify(&self, calldata: &sdk::Calldata, wallet_blob_nonce: u128) -> Result<String, String> {
        match self {
            AuthMethod::Uninitialized => Err("Wallet is not initialized".to_string()),
            AuthMethod::Jwt { hash } => {
                let check_jwt = calldata
                    .blobs
                    .iter()
                    .find(|(_, b)| b.contract_name.0 == "check_jwt")
                    .map(|(_, b)| &b.data)
                    .ok_or("Missing check_mail blob")?;

                let (mail_hash, nonce) = AuthMethod::parse_blob_infos(check_jwt)?;

                if mail_hash != hash {
                    return Err(format!(
                        "Invalid authentication, expected {hash:?}, got {mail_hash:?}"
                    ));
                }

                // Check that the nonce is superior to the last one used for this account
                if nonce != wallet_blob_nonce {
                    return Err("Invalid nonce".to_string());
                }

                Ok("Authentication successful".to_string())
            }

            AuthMethod::Ethereum { address } => {
                let blob = calldata
                    .blobs
                    .get(&BlobIndex(1)) // FIXME: hardcoded index for now
                    .ok_or("Invalid blob index for secp256k1")?;
                let secp256k1blob: Secp256k1Blob = borsh::from_slice(&blob.data.0)
                    .map_err(|e| format!("Failed to decode Eth Secp256k1Blob: {e}"))?;

                let identity = &calldata.identity;

                let signing_message =
                    format!("Sign in to Hyli as {identity} with nonce {wallet_blob_nonce}");
                let expected_message = format!(
                    "\x19Ethereum Signed Message:\n{}{signing_message}",
                    signing_message.len()
                );

                let digest: [u8; 32] = Keccak256::digest(expected_message.as_bytes()).into();
                if secp256k1blob.data != digest {
                    return Err(format!(
                        "Invalid signature data, expected {} got {}, expected_message was: {expected_message}, nonce is {wallet_blob_nonce}",
                        hex::encode(digest),
                        hex::encode(secp256k1blob.data)
                    ));
                }

                let public_key = utils::parse_public_key(&secp256k1blob.public_key)?;

                let derived_address_hex = utils::ethereum_address_from_public_key(&public_key);
                let expected_address = address.trim_start_matches("0x").to_lowercase();

                if derived_address_hex != expected_address {
                    return Err(format!(
                        "Invalid address: expected {address}, derived 0x{derived_address_hex}",
                    ));
                }

                Ok("Authentication successful".to_string())
            }

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

            AuthMethod::HyliApp { address } => {
                let blob = calldata
                    .blobs
                    .get(&BlobIndex(1)) // FIXME: hardcoded index for now
                    .ok_or("Invalid blob index for secp256k1")?;
                let secp256k1blob: Secp256k1Blob = borsh::from_slice(&blob.data.0)
                    .map_err(|e| format!("Failed to decode Secp256k1Blob: {e}"))?;

                let identity = &calldata.identity;

                // For HyliApp (HyliApp), the message format is: "{identity}:{nonce}:hyliapp"
                let expected_message = format!("{identity}:{wallet_blob_nonce}:hyliapp");

                let digest: [u8; 32] = Sha256::digest(expected_message.as_bytes()).into();
                if secp256k1blob.data != digest {
                    return Err(format!(
                        "Invalid signature data, expected {} got {}, expected_message was: {expected_message}, nonce is {wallet_blob_nonce}",
                        hex::encode(digest),
                        hex::encode(secp256k1blob.data)
                    ));
                }

                let public_key = utils::parse_public_key(&secp256k1blob.public_key)?;

                // Derive address from public key using SHA256 and take first 20 bytes
                let pubkey_hash = Sha256::digest(&public_key.serialize());
                let derived_address_hex = hex::encode(&pubkey_hash[..20]);
                let expected_address = address.trim_start_matches("0x").to_lowercase();

                if derived_address_hex != expected_address {
                    return Err(format!(
                        "Invalid address: expected {address}, derived {derived_address_hex}",
                    ));
                }

                Ok("Authentication successful".to_string())
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
    ) -> Result<String, String> {
        auth_method.verify(calldata, nonce)?;
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

        self.verify_and_update_nonce(nonce, calldata)?;

        self.use_session_key(public_key, calldata)
    }

    fn handle_authenticated_action(
        &mut self,
        action: WalletAction,
        calldata: &sdk::Calldata,
    ) -> Result<String, String> {
        match action {
            WalletAction::VerifyIdentity { nonce, account } => {
                // Verify identity before executing the action
                self.auth_method.verify(calldata, nonce)?;
                if self.identity != account {
                    return Err("Account does not match registered identity".to_string());
                }
                self.verify_and_update_nonce(nonce, calldata)
            }
            WalletAction::AddSessionKey {
                account,
                key,
                expiration_date,
                whitelist,
                lane_id,
                nonce,
            } => {
                // Verify identity before executing the action
                self.auth_method.verify(calldata, nonce)?;

                self.verify_and_update_nonce(nonce, calldata)?;

                if self.identity != account {
                    return Err("Account does not match registered identity".to_string());
                }
                self.add_session_key(key, expiration_date, whitelist, lane_id)
            }
            WalletAction::RemoveSessionKey { key, nonce, .. } => {
                // Verify identity before executing the action
                self.auth_method.verify(calldata, nonce)?;

                self.verify_and_update_nonce(nonce, calldata)?;

                self.remove_session_key(key)
            }
            _ => unreachable!(),
        }
    }

    /// Helper function to check if a VerifyIdentity action exists in previous blobs for the same user
    fn check_verify_identity_in_previous_blobs(
        &self,
        calldata: &sdk::Calldata,
        expected_account: &str,
    ) -> Result<(), String> {
        // Iterate through blobs before the current one
        for (blob_index, blob) in &calldata.blobs {
            // Skip the current blob and any after it
            if blob_index >= &calldata.index {
                break;
            }

            // Check if this is a wallet blob
            if blob.contract_name.0 == "wallet" {
                // Try to decode the blob as a WalletAction
                if let Ok(
                    WalletAction::VerifyIdentity { account, .. }
                    | WalletAction::RegisterIdentity { account, .. },
                ) = WalletAction::from_blob_data(&blob.data)
                {
                    if account == expected_account {
                        return Ok(());
                    }
                }
            }
        }

        Err(format!(
            "No action that proves identity found in previous blobs for account: {expected_account}. calldata.blobs: {:?}", calldata.blobs
        ))
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

    fn verify_and_update_nonce(
        &mut self,
        nonce: u128,
        calldata: &sdk::Calldata,
    ) -> Result<String, String> {
        if nonce < self.nonce {
            return Err("Invalid nonce".to_string());
        }
        if nonce == self.nonce {
            // Check if there's a VerifyIdentity action in previous blobs for this user
            self.check_verify_identity_in_previous_blobs(calldata, &self.identity)?;
            return Ok("Identity verified".to_string());
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
            whitelist,
            lane_id,
        });
        Ok("Session key added".to_string())
    }

    fn remove_session_key(&mut self, key: String) -> Result<String, String> {
        let initial_len = self.session_keys.len();
        self.session_keys.retain(|sk| sk.public_key != key);

        if self.session_keys.len() == initial_len {
            return Err("Session key not found".to_string());
        }

        Ok("Session key removed".to_string())
    }

    fn use_session_key(
        &mut self,
        public_key: String,
        calldata: &sdk::Calldata,
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
#[serde_with::serde_as]
#[derive(Serialize, Deserialize, BorshSerialize, BorshDeserialize, Debug, Clone)]
pub enum WalletAction {
    RegisterIdentity {
        account: String,
        nonce: u128,
        salt: String, // Not actually used in the circuit, provided as DA
        auth_method: AuthMethod,
        invite_code: String,
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
        nonce: u128,
    },
    RemoveSessionKey {
        account: String,
        key: String,
        nonce: u128,
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
        borsh::from_slice(&blob_data.0)
            .map_err(|e| anyhow::anyhow!("Failed to decode WalletAction from blob data: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use crate::client::tx_executor_handler::Wallet;

    use super::*;
    use client_sdk::transaction_builder::TxExecutorHandler;
    use sdk::{Blob, BlobIndex, Calldata, IndexedBlobs};

    #[test]
    fn test_blob_data_decode() {
        let time = 1672531199000u128; // Example timestamp in milliseconds
        let ascii_time_0padded = format!("{time:0>13}");

        let hash32bytes = [1u8; 32]; // Example 32-byte hash

        // 32 bytes hash + ":" separator + 13 bytes ASCII timestamp
        let blob_data = sdk::BlobData(
            [
                hash32bytes.as_slice(),
                b":",
                ascii_time_0padded.as_bytes(),
                // add some extra junk bytes to ensure we only read the first 46 bytes
                b"ejb",
            ]
            .concat(),
        );
        let (parsed_hash, parsed_time) =
            AuthMethod::parse_blob_infos(&blob_data).expect("Failed to parse blob data");
        assert_eq!(parsed_hash, &hash32bytes);
        assert_eq!(parsed_time, time);
    }

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
                        salt: "test_salt".to_string(),
                        auth_method: AuthMethod::Password {
                            hash: hex_encoded_hash.clone(),
                        },
                        invite_code: "test_invite_code".to_string(),
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
            salt: "test_salt".to_string(),
            auth_method: AuthMethod::Password {
                hash: hex_encoded_hash.clone(),
            },
            invite_code: "test_invite_code".to_string(),
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
    fn test_check_verify_identity_in_previous_blobs() {
        let nonce = 1769086402327;
        // Test based on the image showing 3 blobs with bob identity
        let account_info = AccountInfo {
            identity: "bob".to_string(),
            auth_method: AuthMethod::Ethereum {
                address: "0x6853cc7d35451325053706ad5f188df79f0387c".to_string(),
            },
            session_keys: vec![],
            nonce,
        };

        // Create blob #0 - secp256k1 blob (from image)
        let secp256k1_blob = Blob {
            contract_name: sdk::ContractName("secp256k1".to_string()),
            data: sdk::BlobData(vec![/* secp256k1 data would go here */]),
        };

        // Create blob #1 - secp256k1 blob (from image)
        let secp256k1_blob2 = Blob {
            contract_name: sdk::ContractName("secp256k1".to_string()),
            data: sdk::BlobData(vec![/* secp256k1 data would go here */]),
        };

        // Create blob #2 - RegisterIdentity action for bob (from image)
        let register_identity_blob = WalletAction::RegisterIdentity {
            account: "bob".to_string(),
            nonce,
            salt: "***".to_string(),
            auth_method: AuthMethod::Ethereum {
                address: "0x6853cc7d35451325053706ad5f188df79f0387c".to_string(),
            },
            invite_code: "***".to_string(),
        }
        .as_blob(sdk::ContractName("wallet".to_string()));

        // Create blob #3 - AddSessionKey action for bob (from image)
        let add_session_key_blob = WalletAction::AddSessionKey {
            account: "bob".to_string(),
            key: "0288fb774209924f7ea2221bf136919b3765d662f6d1d93c36c2ef0b8c3b71db6".to_string(),
            expiration_date: 1769945603806,
            whitelist: None,
            lane_id: None,
            nonce,
        }
        .as_blob(sdk::ContractName("wallet".to_string()));

        // Test case 1: Current blob is #3, should find RegisterIdentity in blob #2
        let calldata_with_register = Calldata {
            blobs: IndexedBlobs::from(vec![
                secp256k1_blob.clone(),
                secp256k1_blob2.clone(),
                register_identity_blob.clone(),
                add_session_key_blob.clone(),
            ]),
            index: BlobIndex(3), // Current blob is #3 (AddSessionKey)
            identity: "bob".into(),
            ..Default::default()
        };

        // Should succeed because RegisterIdentity for bob exists in blob #2
        let result =
            account_info.check_verify_identity_in_previous_blobs(&calldata_with_register, "bob");
        assert!(
            result.is_ok(),
            "Should find RegisterIdentity in previous blobs"
        );

        // Test case 2: Current blob is #2, should not find any previous identity proof
        let calldata_current_register = Calldata {
            blobs: IndexedBlobs::from(vec![
                secp256k1_blob.clone(),
                secp256k1_blob2.clone(),
                register_identity_blob.clone(),
                add_session_key_blob.clone(),
            ]),
            index: BlobIndex(2), // Current blob is #2 (RegisterIdentity)
            identity: "bob".into(),
            ..Default::default()
        };

        // Should fail because no previous identity proof exists before blob #2
        let result =
            account_info.check_verify_identity_in_previous_blobs(&calldata_current_register, "bob");
        assert!(
            result.is_err(),
            "Should not find identity proof in previous blobs"
        );

        // Test case 3: Wrong account name
        let result = account_info
            .check_verify_identity_in_previous_blobs(&calldata_with_register, "wrongAccount");
        assert!(result.is_err(), "Should fail with wrong account name");

        // Test case 4: Test with VerifyIdentity action instead of RegisterIdentity
        let verify_identity_blob = WalletAction::VerifyIdentity {
            account: "bob".to_string(),
            nonce,
        }
        .as_blob(sdk::ContractName("wallet".to_string()));

        let calldata_with_verify = Calldata {
            blobs: IndexedBlobs::from(vec![
                secp256k1_blob.clone(),
                secp256k1_blob2.clone(),
                verify_identity_blob.clone(),
                add_session_key_blob.clone(),
            ]),
            index: BlobIndex(3), // Current blob is #3
            identity: "bob".into(),
            ..Default::default()
        };

        // Should succeed because VerifyIdentity for bob exists in blob #2
        let result =
            account_info.check_verify_identity_in_previous_blobs(&calldata_with_verify, "bob");
        assert!(
            result.is_ok(),
            "Should find VerifyIdentity in previous blobs"
        );
    }
}
