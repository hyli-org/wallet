use sha2::Digest;
use std::collections::HashMap;

use anyhow::Context;
use borsh::{BorshDeserialize, BorshSerialize};
use client_sdk::transaction_builder::TxExecutorHandler;
use sdk::{
    merkle_utils::BorshableMerkleProof, utils::as_hyle_output, Blob, Calldata,
    RegisterContractEffect, StateCommitment,
};
use serde::Serialize;

use crate::{
    check_for_invite_code, get_state_commitment, smt::AccountSMT, AccountInfo, AuthMethod,
    InviteCodePubKey, PartialWalletData, WalletAction, WalletZkView,
    DEFAULT_INVITE_CODE_PUBLIC_KEY,
};

#[serde_with::serde_as]
#[derive(Debug, Clone, Serialize, BorshSerialize, BorshDeserialize)]
pub struct Wallet {
    #[serde_as(as = "[_; 33]")]
    invite_code_public_key: InviteCodePubKey,
    smt: AccountSMT,
    // Keep track of salts so users can query them.
    salts: HashMap<String, String>,
}

#[serde_with::serde_as]
#[derive(Debug, Clone, Serialize, BorshSerialize, BorshDeserialize)]
pub struct WalletConstructor {
    hyli_password_hash: String,
    #[serde_as(as = "[_; 33]")]
    invite_code_public_key: InviteCodePubKey,
}

impl WalletConstructor {
    pub fn new(hyli_password: String, invite_code_public_key: InviteCodePubKey) -> Self {
        let mut d = "hyli@wallet:".as_bytes().to_vec();

        d.extend_from_slice(&sha2::Sha256::digest(format!(
            "{}:{}",
            hyli_password, "hyli-random-salt"
        )));
        let hash = sha2::Sha256::digest(&d);

        Self {
            hyli_password_hash: hex::encode(hash),
            invite_code_public_key,
        }
    }
}

/*
impl Default for Wallet {
    fn default() -> Self {
        Self {
            // Default bad pubkey, replaced immediately
            invite_code_public_key: DEFAULT_INVITE_CODE_PUBLIC_KEY,
            smt: AccountSMT::default(),
            salts: HashMap::new(),
        }
    }
}
 */
impl TxExecutorHandler for Wallet {
    fn build_commitment_metadata(&self, blob: &Blob) -> anyhow::Result<Vec<u8>> {
        let wallet_action: Result<WalletAction, _> = WalletAction::from_blob_data(&blob.data);
        let zk_view = match wallet_action {
            Ok(wallet_action) => match wallet_action {
                WalletAction::UpdateInviteCodePublicKey { .. } => WalletZkView {
                    commitment: get_state_commitment(
                        *self.smt.0.root(),
                        self.invite_code_public_key,
                    ),
                    invite_code_public_key: self.invite_code_public_key,
                    partial_data: vec![],
                },
                WalletAction::RegisterIdentity { account, .. }
                | WalletAction::VerifyIdentity { account, .. }
                | WalletAction::UseSessionKey { account, .. }
                | WalletAction::AddSessionKey { account, .. }
                | WalletAction::RemoveSessionKey { account, .. } => {
                    let mut account_info = self.smt.0.get(&AccountInfo::compute_key(&account))?;
                    account_info.identity = account.clone();
                    WalletZkView {
                        commitment: self.get_state_commitment(),
                        invite_code_public_key: self.invite_code_public_key,
                        partial_data: vec![PartialWalletData {
                            proof: BorshableMerkleProof(
                                self.smt
                                    .0
                                    .merkle_proof(vec![AccountInfo::compute_key(&account)])
                                    .expect("Failed to generate proof"),
                            ),
                            account_info,
                        }],
                    }
                }
            },
            Err(_) => {
                // Return a valid WalletZkView with empty partial data, to generate proof of failures
                WalletZkView {
                    commitment: self.get_state_commitment(),
                    invite_code_public_key: self.invite_code_public_key,
                    partial_data: vec![],
                }
            }
        };
        borsh::to_vec(&zk_view).context("Failed to serialize WalletZkView for commitment metadata")
    }

    fn merge_commitment_metadata(
        &self,
        initial: Vec<u8>,
        next: Vec<u8>,
    ) -> anyhow::Result<Vec<u8>, String> {
        let initial_view: WalletZkView = borsh::from_slice(&initial)
            .map_err(|e| format!("Failed to deserialize initial view: {}", e))?;
        let mut next_view: WalletZkView = borsh::from_slice(&next)
            .map_err(|e| format!("Failed to deserialize next view: {}", e))?;

        next_view.partial_data.extend(initial_view.partial_data);
        next_view.commitment = initial_view.commitment;

        borsh::to_vec(&next_view).map_err(|e| format!("Failed to serialize combined view: {}", e))
    }

    fn handle(&mut self, calldata: &Calldata) -> anyhow::Result<sdk::HyleOutput> {
        self.actual_handle(calldata)
            .map_err(|e| anyhow::anyhow!("Failed to handle Wallet action: {}", e))
    }

    fn get_state_commitment(&self) -> StateCommitment {
        get_state_commitment(*self.smt.0.root(), self.invite_code_public_key)
    }

    fn construct_state(
        _register_blob: &RegisterContractEffect,
        metadata: &Option<Vec<u8>>,
    ) -> anyhow::Result<Self> {
        let mut this = Self {
            // Default bad pubkey, replaced immediately
            invite_code_public_key: DEFAULT_INVITE_CODE_PUBLIC_KEY,
            smt: AccountSMT::default(),
            salts: HashMap::new(),
        };
        if let Some(Ok(constructor_data)) = metadata
            .as_ref()
            .map(|m| borsh::from_slice::<WalletConstructor>(m))
        {
            this.invite_code_public_key = constructor_data.invite_code_public_key;
            this.smt
                .0
                .update(
                    AccountInfo::compute_key(&"hyli".to_string()),
                    AccountInfo {
                        identity: "hyli".to_string(),
                        auth_method: AuthMethod::Password {
                            hash: constructor_data.hyli_password_hash.clone(),
                        },
                        session_keys: vec![],
                        nonce: 0,
                    },
                )
                .map_err(|e| anyhow::anyhow!("Failed to update account info in SMT: {}", e))?;
            this.salts
                .insert("hyli".to_string(), "hyli-random-salt".to_string());
        }

        Ok(this)
    }
}

impl Wallet {
    pub fn new(constructor: &Option<WalletConstructor>) -> anyhow::Result<Self> {
        Wallet::construct_state(
            &RegisterContractEffect::default(),
            &constructor
                .as_ref()
                .map(|c| borsh::to_vec(&c).context("serializing wallet constructor"))
                .transpose()?,
        )
    }

    pub fn get_smt_root(&self) -> [u8; 32] {
        self.smt
            .0
            .root()
            .as_slice()
            .try_into()
            .expect("SMT root is not 32 bytes")
    }

    pub fn get(&self, account: &String) -> anyhow::Result<AccountInfo> {
        let acc = self
            .smt
            .0
            .get(&AccountInfo::compute_key(account))
            .map_err(|e| {
                anyhow::anyhow!("Failed to get account {} info from SMT: {}", account, e)
            })?;
        if acc.auth_method == AuthMethod::Uninitialized {
            Err(anyhow::anyhow!("Account {} does not exist", account))
        } else {
            Ok(acc)
        }
    }

    pub fn get_salt(&self, account: &String) -> anyhow::Result<String> {
        self.salts
            .get(account)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Salt for account {} not found", account))
    }

    fn actual_handle(&mut self, calldata: &Calldata) -> Result<sdk::HyleOutput, String> {
        let initial_state_commitment = self.get_state_commitment();

        let (action, exec_ctx) = sdk::utils::parse_raw_calldata::<WalletAction>(calldata)?;

        if let WalletAction::UpdateInviteCodePublicKey {
            invite_code_public_key,
            ..
        } = action
        {
            // Source of trust is trust me bro for this one.
            if self.invite_code_public_key != DEFAULT_INVITE_CODE_PUBLIC_KEY {
                return Err("Invite code public key already set".to_string());
            }
            self.invite_code_public_key = invite_code_public_key;
            return Ok(as_hyle_output(
                initial_state_commitment,
                self.get_state_commitment(),
                calldata,
                &mut Ok(("Updated public key".as_bytes().to_vec(), exec_ctx, vec![])),
            ));
        }
        let acc = match action.clone() {
            WalletAction::RegisterIdentity { account, .. }
            | WalletAction::VerifyIdentity { account, .. }
            | WalletAction::UseSessionKey { account, .. }
            | WalletAction::AddSessionKey { account, .. }
            | WalletAction::RemoveSessionKey { account, .. } => account,
            _ => unreachable!(),
        };
        let mut account_info = self
            .smt
            .0
            .get(&AccountInfo::compute_key(&acc))
            .map_err(|e| format!("Failed to get account info from SMT: {}", e))?;
        account_info.identity = acc.clone();

        let result = match action {
            WalletAction::RegisterIdentity {
                account,
                nonce,
                salt,
                auth_method,
                invite_code,
            } => {
                check_for_invite_code(
                    &account,
                    &invite_code,
                    calldata,
                    &self.invite_code_public_key,
                )?;
                let res =
                    account_info.handle_registration(account.clone(), nonce, auth_method, calldata);
                self.salts.insert(account, salt);
                res
            }
            WalletAction::UseSessionKey { account, nonce } => {
                account_info.handle_session_key_usage(account, nonce, calldata)
            }
            _ => account_info.handle_authenticated_action(action, calldata),
        };

        self.smt
            .0
            .update(AccountInfo::compute_key(&acc), account_info)
            .map_err(|e| format!("Failed to update account info in SMT: {}", e))?;

        let next_state_commitment = self.get_state_commitment();

        let mut res = result.map(|res| (res.into_bytes(), exec_ctx, vec![]));
        Ok(as_hyle_output(
            initial_state_commitment,
            next_state_commitment,
            calldata,
            &mut res,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use client_sdk::transaction_builder::TxExecutorHandler;
    use sdk::{
        Blob, BlobData, BlobIndex, Calldata, ContractName, Identity, IndexedBlobs, TxHash,
        ZkContract,
    };

    #[test]
    fn test_proof_of_failure() {
        let wallet = Wallet::new(&None).expect("Failed to create wallet");

        // Create a dummy blob
        let blob = Blob {
            contract_name: ContractName::new("Wallet"),
            data: BlobData(vec![43, 12, 56]),
        };

        let commitment = wallet
            .build_commitment_metadata(&blob)
            .expect("Failed to build commitment metadata");

        let mut zk = borsh::from_slice::<WalletZkView>(&commitment)
            .expect("Failed to deserialize WalletZkView");

        // Attempt to handle the invalid calldata
        let result = zk.execute(&Calldata {
            tx_hash: TxHash::default(),
            identity: Identity::default(),
            blobs: IndexedBlobs::from(vec![blob]),
            tx_blob_count: 1,
            index: BlobIndex(0),
            tx_ctx: None,
            private_input: vec![],
        });

        // Check that it returns an error
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Could not deserialize Blob at index 0");
    }
}
