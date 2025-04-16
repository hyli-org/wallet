use anyhow::anyhow;
use borsh::BorshDeserialize;
use borsh::BorshSerialize;
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
    amount: u128,
    address: Identity,
    timestamp: String,
}

#[derive(Debug, Clone, Default, Serialize, BorshDeserialize, BorshSerialize)]
pub struct HyllarHistory {
    hyllar: Hyllar,
    history: BTreeMap<Identity, Vec<TransactionDetails>>,
}

impl HyllarHistory {
    pub fn update_history(
        &mut self,
        identity: Identity,
        address: Identity,
        action: &str,
        amount: u128,
        tx_hash: TxHash,
    ) {
        let transaction = TransactionDetails {
            id: tx_hash.0,
            r#type: action.to_string(),
            amount,
            address,
            timestamp: "2023-10-01T00:00:00Z".to_string(),
        };
        self.history.entry(identity).or_default().push(transaction);
    }
}

impl TxExecutorHandler for HyllarHistory {
    fn handle(&mut self, calldata: &sdk::Calldata) -> anyhow::Result<sdk::HyleOutput, String> {
        let (action, _) = parse_calldata::<HyllarAction>(calldata)?;

        match action {
            HyllarAction::Transfer { recipient, amount } => {
                // Update history for the sender
                self.update_history(
                    calldata.identity.clone(),
                    recipient.clone().into(),
                    "Send",
                    amount,
                    calldata.tx_hash.clone(),
                );
                // Update history for the receiver
                self.update_history(
                    recipient.into(),
                    calldata.identity.clone(),
                    "Receive",
                    amount,
                    calldata.tx_hash.clone(),
                );
            }
            HyllarAction::Approve { spender, amount } => {
                self.update_history(
                    calldata.identity.clone(),
                    spender.into(),
                    "Approve",
                    amount,
                    calldata.tx_hash.clone(),
                );
            }
            HyllarAction::TransferFrom {
                owner,
                recipient,
                amount,
            } => {
                self.update_history(
                    recipient.clone().into(),
                    owner.clone().into(),
                    "Receive TransferFrom",
                    amount,
                    calldata.tx_hash.clone(),
                );
                self.update_history(
                    owner.into(),
                    recipient.into(),
                    "Send TransferFrom",
                    amount,
                    calldata.tx_hash.clone(),
                );
            }
            _ => {}
        }

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
