use anyhow::{anyhow, Result};
use borsh::{BorshDeserialize, BorshSerialize};
use client_sdk::light_executor::{LightContractExecutor, LightExecutorOutput};
use sdk::{BlobIndex, BlobTransaction, Calldata, Hashed, Identity, IndexedBlobs, TxContext};
use std::collections::HashMap;

use crate::{
    check_for_invite_code, client::tx_executor_handler::WalletConstructor, AccountInfo, AuthMethod,
    WalletAction, DEFAULT_INVITE_CODE_PUBLIC_KEY,
};

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

fn parse_raw_blob_from_tx(tx: &BlobTransaction, index: BlobIndex) -> Option<WalletAction> {
    let blob = tx.blobs.get(index.0)?;
    let Ok(parameters) = borsh::from_slice::<WalletAction>(blob.data.0.as_slice()) else {
        return None;
    };
    Some(parameters)
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
        let Some(parsed_blob) = parse_raw_blob_from_tx(tx, index) else {
            return Err(anyhow!("Failed to parse structured blob from transaction"));
        };

        self.inner_handle(tx, index, tx_ctx, parsed_blob)
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
    pub fn new(constructor: &Option<WalletConstructor>) -> anyhow::Result<Self> {
        let mut this = Self {
            // Default bad pubkey, replaced immediately
            invite_code_public_key: DEFAULT_INVITE_CODE_PUBLIC_KEY,
            accounts: HashMap::new(),
            salts: HashMap::new(),
        };
        if let Some(constructor_data) = constructor {
            this.invite_code_public_key = constructor_data.invite_code_public_key;
            this.accounts.insert(
                "hyli".to_string(),
                AccountInfo {
                    identity: "hyli".to_string(),
                    auth_method: AuthMethod::Password {
                        hash: constructor_data.hyli_password_hash.clone(),
                    },
                    session_keys: vec![],
                    nonce: 0,
                },
            );
            this.salts
                .insert("hyli".to_string(), "hyli-random-salt".to_string());
        }

        Ok(this)
    }

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
            WalletAction::UpdateInviteCodePublicKey {
                invite_code_public_key,
                ..
            } => {
                if self.invite_code_public_key != DEFAULT_INVITE_CODE_PUBLIC_KEY {
                    return Err("Invite code public key already set".to_string());
                }
                self.invite_code_public_key = invite_code_public_key;
                Ok("Updated public key".to_string())
            }
            _ => account_info.handle_authenticated_action(action, calldata),
        }
    }
}
