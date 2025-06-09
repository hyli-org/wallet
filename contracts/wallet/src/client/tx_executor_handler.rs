use anyhow::Context;
use borsh::{BorshDeserialize, BorshSerialize};
use client_sdk::transaction_builder::TxExecutorHandler;
use sdk::{
    merkle_utils::BorshableMerkleProof, utils::as_hyle_output, Blob, Calldata,
    RegisterContractEffect, StateCommitment,
};
use serde::Serialize;

use crate::{
    smt::AccountSMT, AccountInfo, AuthMethod, PartialWalletData, WalletAction, WalletZkView,
};

#[derive(Debug, Default, Clone, Serialize, BorshSerialize, BorshDeserialize)]
pub struct Wallet {
    smt: AccountSMT,
}

impl TxExecutorHandler for Wallet {
    fn build_commitment_metadata(&self, blob: &Blob) -> anyhow::Result<Vec<u8>> {
        let wallet_action: WalletAction = WalletAction::from_blob_data(&blob.data)?;
        let zk_view = match wallet_action {
            WalletAction::RegisterIdentity { account, .. }
            | WalletAction::VerifyIdentity { account, .. }
            | WalletAction::UseSessionKey { account, .. }
            | WalletAction::AddSessionKey { account, .. }
            | WalletAction::RemoveSessionKey { account, .. } => {
                let mut account_info = self.smt.0.get(&AccountInfo::compute_key(&account))?;
                account_info.identity = account.clone();
                WalletZkView {
                    commitment: StateCommitment(
                        Into::<[u8; 32]>::into(*self.smt.0.root()).to_vec(),
                    ),
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

    pub fn get_state_commitment(&self) -> StateCommitment {
        StateCommitment(Into::<[u8; 32]>::into(*self.smt.0.root()).to_vec())
    }

    fn actual_handle(&mut self, calldata: &Calldata) -> Result<sdk::HyleOutput, String> {
        let initial_state_commitment =
            StateCommitment(Into::<[u8; 32]>::into(*self.smt.0.root()).to_vec());

        let (action, exec_ctx) = sdk::utils::parse_raw_calldata::<WalletAction>(calldata)?;

        let acc = match action.clone() {
            WalletAction::RegisterIdentity { account, .. }
            | WalletAction::VerifyIdentity { account, .. }
            | WalletAction::UseSessionKey { account, .. }
            | WalletAction::AddSessionKey { account, .. }
            | WalletAction::RemoveSessionKey { account, .. } => account,
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
                auth_method,
            } => account_info.handle_registration(account, nonce, auth_method, calldata),
            WalletAction::UseSessionKey { account, nonce } => {
                account_info.handle_session_key_usage(account, nonce, calldata)
            }
            _ => account_info.handle_authenticated_action(action, calldata),
        };

        self.smt
            .0
            .update(AccountInfo::compute_key(&acc), account_info)
            .map_err(|e| format!("Failed to update account info in SMT: {}", e))?;
        let next_state_commitment =
            StateCommitment(Into::<[u8; 32]>::into(*self.smt.0.root()).to_vec());

        let mut res = result.map(|res| (res.into_bytes(), exec_ctx, vec![]));
        Ok(as_hyle_output(
            initial_state_commitment,
            next_state_commitment,
            calldata,
            &mut res,
        ))
    }
}
