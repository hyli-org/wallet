use anyhow::{anyhow, Result};
use borsh::{BorshDeserialize, BorshSerialize};
use client_sdk::light_executor::{
    parse_structured_blob_from_tx, LightContractExecutor, LightExecutorOutput,
};
use sdk::{BlobIndex, BlobTransaction, Calldata, Hashed, Identity, IndexedBlobs, TxContext};
use std::collections::HashMap;

use crate::{check_for_invite_code, AccountInfo, WalletAction};

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct LightWalletExecutor {
    pub accounts: HashMap<String, AccountInfo>,
    pub salts: HashMap<String, String>,
    pub invite_code_public_key: [u8; 33],
}

impl Default for LightWalletExecutor {
    fn default() -> Self {
        Self {
            accounts: HashMap::new(),
            salts: HashMap::new(),
            invite_code_public_key: [0u8; 33],
        }
    }
}

impl<'a> LightContractExecutor<'a, '_> for LightWalletExecutor {
    type Scratchpad = (&'a BlobTransaction, Option<AccountInfo>);
    type ExtraData = ();

    fn prepare_for_tx(
        &mut self,
        tx: &'a BlobTransaction,
        _index: BlobIndex,
        _tx_ctx: Option<&TxContext>,
        _extra_data: Self::ExtraData,
    ) -> Result<Self::Scratchpad> {
        Ok((tx, self.accounts.get(&tx.identity.0).cloned()))
    }

    fn handle_blob(
        &mut self,
        tx: &BlobTransaction,
        index: BlobIndex,
        tx_ctx: Option<&TxContext>,
        _extra_data: Self::ExtraData,
    ) -> Result<LightExecutorOutput> {
        let Some(parsed_blob) = parse_structured_blob_from_tx::<WalletAction>(tx, index) else {
            return Err(anyhow!("Failed to parse structured blob from transaction"));
        };

        self.inner_handle(tx, index, tx_ctx, parsed_blob.data.parameters)
            .map(|ok| LightExecutorOutput {
                success: true,
                program_outputs: ok.into_bytes(),
            })
            .or_else(|err| {
                Ok(LightExecutorOutput {
                    success: false,
                    program_outputs: err.to_string().into_bytes(),
                })
            })
    }

    fn on_failure(&mut self, scratchpad: Self::Scratchpad) -> Result<()> {
        if let (blob_tx, Some(account_info)) = scratchpad {
            self.accounts
                .insert(blob_tx.identity.0.clone(), account_info);
        }
        Ok(())
    }
    fn on_success(&mut self, _scratchpad: Self::Scratchpad) -> Result<()> {
        Ok(())
    }
}

impl LightWalletExecutor {
    pub fn inner_handle(
        &mut self,
        tx: &BlobTransaction,
        index: BlobIndex,
        tx_ctx: Option<&TxContext>,
        action: WalletAction,
    ) -> Result<String, String> {
        let acc = match action.clone() {
            WalletAction::RegisterIdentity { account, .. }
            | WalletAction::VerifyIdentity { account, .. }
            | WalletAction::UseSessionKey { account, .. }
            | WalletAction::AddSessionKey { account, .. }
            | WalletAction::RemoveSessionKey { account, .. } => account,
            _ => unreachable!(),
        };
        let Some(account_info) = self.accounts.get_mut(&acc) else {
            return Err(format!("Account {acc} not found"));
        };

        let calldata = &Calldata {
            tx_hash: tx.hashed(),
            identity: Identity::new(&acc),
            blobs: IndexedBlobs::from(tx.blobs.clone()),
            tx_blob_count: tx.blobs.len(),
            index,
            tx_ctx: tx_ctx.cloned(),
            private_input: vec![],
        };

        match action {
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
        }
    }
}
