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

impl TxExecutorHandler for Wallet {
    fn build_commitment_metadata(&self, blob: &Blob) -> anyhow::Result<Vec<u8>> {
        let wallet_action: WalletAction = WalletAction::from_blob_data(&blob.data)?;
        let zk_view = match wallet_action {
            WalletAction::UpdateInviteCodePublicKey { .. } => WalletZkView {
                commitment: get_state_commitment(*self.smt.0.root(), self.invite_code_public_key),
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

    fn construct_state(
        _register_blob: &RegisterContractEffect,
        _metadata: &Option<Vec<u8>>,
    ) -> anyhow::Result<Self> {
        Ok(Self::default())
    }
}

impl Wallet {
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

    pub fn get_state_commitment(&self) -> StateCommitment {
        get_state_commitment(*self.smt.0.root(), self.invite_code_public_key)
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
