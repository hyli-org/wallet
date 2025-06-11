use anyhow::anyhow;
use anyhow::Context;
use borsh::BorshDeserialize;
use borsh::BorshSerialize;
use hyle_smt_token::client::tx_executor_handler::SmtTokenProvableState;
use hyle_smt_token::SmtTokenAction;
use sdk::BlobIndex;
use sdk::Calldata;
use sdk::Hashed;
use sdk::RegisterContractEffect;
use sdk::StateCommitment;
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
use sdk::utils::parse_calldata;
use sdk::Identity;
use sdk::TxHash;
use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize, ToSchema, BorshDeserialize, BorshSerialize)]
pub struct TransactionDetails {
    id: String,
    r#type: String,
    status: String,
    amount: u128,
    address: Identity,
    timestamp: u128,
}

#[derive(Debug, Clone, Default, BorshDeserialize, BorshSerialize)]
pub struct TokenHistory {
    token: SmtTokenProvableState,
    history: BTreeMap<Identity, Vec<TransactionDetails>>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct HistoryEvent {
    pub account: Identity,
    pub tx: TransactionDetails,
}

impl TokenHistory {
    pub fn add_to_history(
        &mut self,
        identity: Identity,
        address: Identity,
        action: &str,
        amount: u128,
        tx_hash: TxHash,
        timestamp: u128,
    ) -> HistoryEvent {
        let transaction = TransactionDetails {
            id: tx_hash.0,
            r#type: action.to_string(),
            amount,
            address,
            timestamp,
            status: "Sequenced".to_string(),
        };
        self.history
            .entry(identity.clone())
            .or_default()
            .insert(0, transaction.clone());
        HistoryEvent {
            account: identity,
            tx: transaction,
        }
    }

    fn get_action(tx: &sdk::BlobTransaction, index: BlobIndex) -> anyhow::Result<SmtTokenAction> {
        let calldata = Calldata {
            identity: tx.identity.clone(),
            index,
            blobs: tx.blobs.clone().into(),
            tx_blob_count: tx.blobs.len(),
            tx_hash: tx.hashed(),
            tx_ctx: None,
            private_input: vec![],
        };
        let (action, _) = parse_calldata::<SmtTokenAction>(&calldata)
            .map_err(|e| anyhow!("Failed to parse calldata: {}", e))?;
        Ok(action)
    }
}

impl TxExecutorHandler for TokenHistory {
    fn handle(&mut self, calldata: &sdk::Calldata) -> anyhow::Result<sdk::HyleOutput> {
        self.token.handle(calldata)
    }

    fn build_commitment_metadata(&self, blob: &sdk::Blob) -> anyhow::Result<Vec<u8>> {
        self.token.build_commitment_metadata(blob)
    }

    fn get_state_commitment(&self) -> StateCommitment {
        StateCommitment::default()
    }

    fn construct_state(
        _register_blob: &RegisterContractEffect,
        _metadata: &Option<Vec<u8>>,
    ) -> anyhow::Result<Self> {
        Ok(Default::default())
    }
}

impl ContractHandler<Vec<HistoryEvent>> for TokenHistory {
    async fn api(store: ContractHandlerStore<TokenHistory>) -> (Router<()>, OpenApi) {
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
    ) -> anyhow::Result<Option<Vec<HistoryEvent>>> {
        let mut events = vec![];
        self.history.iter_mut().for_each(|(account, history)| {
            for t in history.iter_mut().filter(|t| t.id == tx.hashed().0) {
                t.status = "Success".to_string();
                events.push(HistoryEvent {
                    account: account.clone(),
                    tx: t.clone(),
                });
            }
        });
        if !events.is_empty() {
            Ok(Some(events))
        } else {
            Ok(None)
        }
    }

    fn handle_transaction_failed(
        &mut self,
        tx: &sdk::BlobTransaction,
        _index: sdk::BlobIndex,
        _tx_context: sdk::TxContext,
    ) -> anyhow::Result<Option<Vec<HistoryEvent>>> {
        let mut events = vec![];
        self.history.values_mut().for_each(|history| {
            for t in history.iter_mut().filter(|t| t.id == tx.hashed().0) {
                t.status = "Failed".to_string();
                events.push(HistoryEvent {
                    account: tx.identity.clone(),
                    tx: t.clone(),
                });
            }
        });
        if !events.is_empty() {
            Ok(Some(events))
        } else {
            Ok(None)
        }
    }

    fn handle_transaction_timeout(
        &mut self,
        tx: &sdk::BlobTransaction,
        _index: sdk::BlobIndex,
        _tx_context: sdk::TxContext,
    ) -> anyhow::Result<Option<Vec<HistoryEvent>>> {
        let mut events = vec![];
        self.history.values_mut().for_each(|history| {
            for t in history.iter_mut().filter(|t| t.id == tx.hashed().0) {
                t.status = "Timed Out".to_string();
                events.push(HistoryEvent {
                    account: tx.identity.clone(),
                    tx: t.clone(),
                });
            }
        });
        if !events.is_empty() {
            Ok(Some(events))
        } else {
            Ok(None)
        }
    }

    fn handle_transaction_sequenced(
        &mut self,
        tx: &sdk::BlobTransaction,
        index: sdk::BlobIndex,
        tx_context: sdk::TxContext,
    ) -> anyhow::Result<Option<Vec<HistoryEvent>>> {
        let action = Self::get_action(tx, index)
            .with_context(|| format!("Failed to get action for transaction: {:?}", tx))?;
        let timestamp = tx_context.timestamp.0;
        let mut events = vec![];

        match action {
            SmtTokenAction::Transfer {
                sender,
                recipient,
                amount,
            } => {
                // Update history for the sender
                events.push(self.add_to_history(
                    sender.clone(),
                    recipient.clone(),
                    "Send",
                    amount,
                    tx.hashed(),
                    timestamp,
                ));
                // Update history for the receiver
                events.push(self.add_to_history(
                    recipient,
                    sender,
                    "Receive",
                    amount,
                    tx.hashed(),
                    timestamp,
                ));
            }
            SmtTokenAction::Approve {
                spender,
                amount,
                owner,
            } => {
                events.push(self.add_to_history(
                    owner,
                    spender,
                    "Approve",
                    amount,
                    tx.hashed(),
                    timestamp,
                ));
            }
            SmtTokenAction::TransferFrom {
                owner,
                recipient,
                amount,
                spender: _,
            } => {
                events.push(self.add_to_history(
                    recipient.clone(),
                    owner.clone(),
                    "Receive TransferFrom",
                    amount,
                    tx.hashed(),
                    timestamp,
                ));
                events.push(self.add_to_history(
                    owner,
                    recipient,
                    "Send TransferFrom",
                    amount,
                    tx.hashed(),
                    timestamp,
                ));
            }
        }
        if !events.is_empty() {
            Ok(Some(events))
        } else {
            Ok(None)
        }
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
    State(state): State<ContractHandlerStore<TokenHistory>>,
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
