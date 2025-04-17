use anyhow::anyhow;
use anyhow::Context;
use borsh::BorshDeserialize;
use borsh::BorshSerialize;
use sdk::info;
use sdk::BlobIndex;
use sdk::Calldata;
use sdk::Hashed;
use std::collections::BTreeMap;

use client_sdk::contract_indexer::axum;
use client_sdk::contract_indexer::utoipa;
use client_sdk::contract_indexer::{
    axum::{
        extract::{Path, State},
        http::StatusCode,
        response::IntoResponse,
        Json, Router,
    },
    utoipa::{openapi::OpenApi, ToSchema},
    utoipa_axum::{router::OpenApiRouter, routes},
    AppError, ContractHandler, ContractHandlerStore,
};
use client_sdk::transaction_builder::TxExecutorHandler;
use hyle_hyllar::Hyllar;
use hyle_hyllar::HyllarAction;
use sdk::utils::parse_calldata;
use sdk::Identity;
use sdk::TxHash;
use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize, ToSchema, BorshDeserialize, BorshSerialize)]
struct TransactionDetails {
    id: String,
    r#type: String,
    status: String,
    amount: u128,
    address: Identity,
    timestamp: u128,
}

#[derive(Debug, Clone, Default, Serialize, BorshDeserialize, BorshSerialize)]
pub struct HyllarHistory {
    hyllar: Hyllar,
    history: BTreeMap<Identity, Vec<TransactionDetails>>,
}

impl HyllarHistory {
    pub fn add_to_history(
        &mut self,
        identity: Identity,
        address: Identity,
        action: &str,
        amount: u128,
        tx_hash: TxHash,
        timestamp: u128,
    ) {
        let transaction = TransactionDetails {
            id: tx_hash.0,
            r#type: action.to_string(),
            amount,
            address,
            timestamp,
            status: "Sequenced".to_string(),
        };
        self.history
            .entry(identity)
            .or_default()
            .insert(0, transaction);
    }

    fn get_action(tx: &sdk::BlobTransaction, index: BlobIndex) -> anyhow::Result<HyllarAction> {
        let calldata = Calldata {
            identity: tx.identity.clone(),
            index,
            blobs: tx.blobs.clone().into(),
            tx_blob_count: tx.blobs.len(),
            tx_hash: tx.hashed(),
            tx_ctx: None,
            private_input: vec![],
        };
        let (action, _) = parse_calldata::<HyllarAction>(&calldata)
            .map_err(|e| anyhow!("Failed to parse calldata: {}", e))?;
        Ok(action)
    }
}

impl TxExecutorHandler for HyllarHistory {
    fn handle(&mut self, calldata: &sdk::Calldata) -> anyhow::Result<sdk::HyleOutput, String> {
        self.hyllar.handle(calldata)
    }

    fn build_commitment_metadata(&self, blob: &sdk::Blob) -> anyhow::Result<Vec<u8>, String> {
        self.hyllar.build_commitment_metadata(blob)
    }
}

impl ContractHandler for HyllarHistory {
    async fn api(store: ContractHandlerStore<HyllarHistory>) -> (Router<()>, OpenApi) {
        let (router, api) = OpenApiRouter::default()
            .routes(routes!(get_history))
            .split_for_parts();

        (router.with_state(store), api)
    }

    fn handle_transaction_success(
        &mut self,
        tx: &sdk::BlobTransaction,
        _index: sdk::BlobIndex,
        _tx_context: sdk::TxContext,
    ) -> anyhow::Result<()> {
        info!("Transaction successful: {:?}", tx);
        self.history.values_mut().for_each(|history| {
            if let Some(t) = history.iter_mut().find(|t| t.id == tx.hashed().0) {
                t.status = "Success".to_string();
            }
        });
        Ok(())
    }

    fn handle_transaction_failed(
        &mut self,
        tx: &sdk::BlobTransaction,
        _index: sdk::BlobIndex,
        _tx_context: sdk::TxContext,
    ) -> anyhow::Result<()> {
        self.history.values_mut().for_each(|history| {
            if let Some(t) = history.iter_mut().find(|t| t.id == tx.hashed().0) {
                t.status = "Failed".to_string();
            }
        });
        Ok(())
    }

    fn handle_transaction_timeout(
        &mut self,
        tx: &sdk::BlobTransaction,
        _index: sdk::BlobIndex,
        _tx_context: sdk::TxContext,
    ) -> anyhow::Result<()> {
        self.history.values_mut().for_each(|history| {
            if let Some(t) = history.iter_mut().find(|t| t.id == tx.hashed().0) {
                t.status = "Timed Out".to_string();
            }
        });
        Ok(())
    }

    fn handle_transaction_sequenced(
        &mut self,
        tx: &sdk::BlobTransaction,
        index: sdk::BlobIndex,
        tx_context: sdk::TxContext,
    ) -> anyhow::Result<()> {
        let action = Self::get_action(tx, index)
            .with_context(|| format!("Failed to get action for transaction: {:?}", tx))?;
        let timestamp = tx_context.timestamp.0;

        match action {
            HyllarAction::Transfer { recipient, amount } => {
                // Update history for the sender
                self.add_to_history(
                    tx.identity.clone(),
                    recipient.clone().into(),
                    "Send",
                    amount,
                    tx.hashed(),
                    timestamp,
                );
                // Update history for the receiver
                self.add_to_history(
                    recipient.into(),
                    tx.identity.clone(),
                    "Receive",
                    amount,
                    tx.hashed(),
                    timestamp,
                );
            }
            HyllarAction::Approve { spender, amount } => {
                self.add_to_history(
                    tx.identity.clone(),
                    spender.into(),
                    "Approve",
                    amount,
                    tx.hashed(),
                    timestamp,
                );
            }
            HyllarAction::TransferFrom {
                owner,
                recipient,
                amount,
            } => {
                self.add_to_history(
                    recipient.clone().into(),
                    owner.clone().into(),
                    "Receive TransferFrom",
                    amount,
                    tx.hashed(),
                    timestamp,
                );
                self.add_to_history(
                    owner.into(),
                    recipient.into(),
                    "Send TransferFrom",
                    amount,
                    tx.hashed(),
                    timestamp,
                );
            }
            _ => {}
        }
        Ok(())
    }
}

#[derive(Serialize, ToSchema)]
struct HistoryResponse {
    account: String,
    history: Vec<TransactionDetails>,
}
#[utoipa::path(
    get,
    path = "/history/{account}",
    params(
        ("account" = String, Path, description = "Account")
    ),
    tag = "Contract",
    responses(
        (status = OK, description = "Get balance of account", body = HistoryResponse)
    )
)]
pub async fn get_history(
    Path(account): Path<Identity>,
    State(state): State<ContractHandlerStore<HyllarHistory>>,
) -> Result<impl IntoResponse, AppError> {
    let store = state.read().await;
    let state = store.state.clone().ok_or(AppError(
        StatusCode::NOT_FOUND,
        anyhow!("Contract '{}' not found", store.contract_name),
    ))?;

    state
        .history
        .get(&account)
        .cloned()
        .map(|history| HistoryResponse {
            account: account.0.clone(),
            history,
        })
        .map(Json)
        .ok_or_else(|| {
            AppError(
                StatusCode::NOT_FOUND,
                anyhow!("No history found for account '{}'", account),
            )
        })
}
