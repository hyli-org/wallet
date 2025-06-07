use std::str;

use anyhow::{anyhow, Context, Result};
use client_sdk::{
    contract_indexer::{
        axum::{
            extract::{Path, State},
            http::StatusCode,
            response::IntoResponse,
            Json, Router,
        },
        utoipa::{openapi::OpenApi, ToSchema},
        utoipa_axum::{router::OpenApiRouter, routes},
        AppError, ContractHandler, ContractHandlerStore,
    },
    transaction_builder::TxExecutorHandler,
};
use sdk::{tracing, Hashed};
use serde::Serialize;

use crate::{client::tx_executor_handler::Wallet, *};
use client_sdk::contract_indexer::axum;
use client_sdk::contract_indexer::utoipa;

#[derive(Debug, Clone, Default, Serialize)]
pub struct WalletEvent {
    pub account: sdk::Identity,
    pub program_outputs: String,
}

impl Wallet {
    fn handle_transaction(
        &mut self,
        tx: &sdk::BlobTransaction,
        index: sdk::BlobIndex,
        tx_context: sdk::TxContext,
    ) -> Result<Option<WalletEvent>> {
        let sdk::Blob {
            contract_name,
            data: _,
        } = tx.blobs.get(index.0).context("Failed to get blob")?;

        let calldata = sdk::Calldata {
            identity: tx.identity.clone(),
            index,
            blobs: tx.blobs.clone().into(),
            tx_blob_count: tx.blobs.len(),
            tx_hash: tx.hashed(),
            tx_ctx: Some(tx_context),
            private_input: vec![],
        };

        let res = self.handle(&calldata);
        let event = match res {
            Ok(hyle_output) => {
                let program_outputs =
                    str::from_utf8(&hyle_output.program_outputs).unwrap_or("no output");

                sdk::info!("🚀 Executed {contract_name}: {}", program_outputs);
                sdk::tracing::debug!(
                    handler = %contract_name,
                    "hyle_output: {:?}", hyle_output
                );
                WalletEvent {
                    account: tx.identity.clone(),
                    program_outputs: program_outputs.to_string(),
                }
            }
            Err(e) => {
                sdk::info!("🚀 Executed {contract_name} with error: {}", e);
                WalletEvent {
                    account: tx.identity.clone(),
                    program_outputs: format!("Error: {:?}", e),
                }
            }
        };

        Ok(Some(event))
    }
}

impl ContractHandler<WalletEvent> for Wallet {
    fn handle_transaction_success(
        &mut self,
        tx: &sdk::BlobTransaction,
        index: sdk::BlobIndex,
        tx_context: sdk::TxContext,
    ) -> Result<Option<WalletEvent>> {
        self.handle_transaction(tx, index, tx_context)
    }

    fn handle_transaction_failed(
        &mut self,
        tx: &sdk::BlobTransaction,
        _index: sdk::BlobIndex,
        _tx_context: sdk::TxContext,
    ) -> Result<Option<WalletEvent>> {
        Ok(Some(WalletEvent {
            account: tx.identity.clone(),
            program_outputs: "Transaction failed".to_string(),
        }))
    }

    fn handle_transaction_timeout(
        &mut self,
        tx: &sdk::BlobTransaction,
        _index: sdk::BlobIndex,
        _tx_context: sdk::TxContext,
    ) -> Result<Option<WalletEvent>> {
        Ok(Some(WalletEvent {
            account: tx.identity.clone(),
            program_outputs: "Transaction timeout".to_string(),
        }))
    }

    async fn api(store: ContractHandlerStore<Wallet>) -> (Router<()>, OpenApi) {
        let (router, api) = OpenApiRouter::default()
            .routes(routes!(get_state))
            .routes(routes!(get_account_info))
            .split_for_parts();

        (router.with_state(store), api)
    }
}

#[utoipa::path(
    get,
    path = "/state",
    tag = "Contract",
    responses(
        (status = OK, description = "Get json state of contract")
    )
)]
pub async fn get_state<S: Serialize + Clone + 'static>(
    State(state): State<ContractHandlerStore<S>>,
) -> Result<impl IntoResponse, AppError> {
    let store = state.read().await;
    store.state.clone().map(Json).ok_or(AppError(
        StatusCode::NOT_FOUND,
        anyhow!("No state found for contract '{}'", store.contract_name),
    ))
}

#[derive(Serialize, ToSchema)]
struct ApiSessionKey {
    key: String,
    expiration_date: u128,
    nonce: u128,
}

#[derive(Serialize, ToSchema)]
struct ApiAccountInfo {
    account: String,
    auth_method: AuthMethod,
    session_keys: Vec<ApiSessionKey>,
    nonce: u128,
    salt: String,
}

#[utoipa::path(
    get,
    path = "/account/{account}",
    tag = "Contract",
    responses(
        (status = OK, description = "Get account information", body = ApiAccountInfo),
        (status = NOT_FOUND, description = "Account not found")
    ),
    params(
        ("account" = String, Path, description = "The account identity")
    )
)]
pub async fn get_account_info(
    Path(account): Path<String>,
    State(state): State<ContractHandlerStore<Wallet>>,
) -> Result<impl IntoResponse, AppError> {
    let store = state.read().await;
    let state = store.state.clone().ok_or(AppError(
        StatusCode::NOT_FOUND,
        anyhow!("Contract '{}' not found", store.contract_name),
    ))?;

    let account_info = state.get(&account);
    let salt = state.get_salt(&account);

    let (account_info, salt) = match (account_info, salt) {
        (Ok(info), Ok(salt)) => (info, salt),
        (Err(e), _) | (_, Err(e)) => {
            tracing::debug!("Error retrieving account info or salt: {}", e);
            return Err(AppError(
                StatusCode::NOT_FOUND,
                anyhow!("Account '{}' not found", account),
            ));
        }
    };

    let session_keys = account_info
        .session_keys
        .iter()
        .map(|sk| ApiSessionKey {
            key: sk.public_key.clone(),
            expiration_date: sk.expiration_date.0,
            nonce: sk.nonce,
        })
        .collect();

    Ok(Json(ApiAccountInfo {
        account,
        auth_method: account_info.auth_method.clone(),
        session_keys,
        nonce: account_info.nonce,
        salt,
    }))
}
