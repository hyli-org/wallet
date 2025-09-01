use std::sync::Arc;

use anyhow::Result;
use axum::{
    extract::{Json, State},
    http::Method,
    response::IntoResponse,
    routing::get,
    Router,
};
use client_sdk::rest_client::NodeApiClient;
use hyli_modules::{
    bus::{BusClientSender, BusMessage, SharedMessageBus},
    module_bus_client, module_handle_messages,
    modules::{
        contract_state_indexer::CSIBusEvent, websocket::WsTopicMessage, BuildApiContextInner,
        Module,
    },
};

use sdk::ContractName;
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};
use wallet::client::indexer::WalletEvent;

use crate::history::HistoryEvent;

pub struct WalletModule {
    bus: AppModuleBusClient,
}

pub struct WalletModuleCtx {
    pub api: Arc<BuildApiContextInner>,
    pub node_client: Arc<dyn NodeApiClient + Send + Sync>,
    pub wallet_cn: ContractName,
}

/// Messages received from WebSocket clients that will be processed by the system
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AppWsInMessage {}

/// Messages sent to WebSocket clients from the system
#[derive(Debug, Clone, Serialize)]
pub enum AppOutWsEvent {
    TxEvent(HistoryEvent),
    WalletEvent { account: String, event: String }, // TODO: Type event for better error handling in frontend
}

module_bus_client! {
#[derive(Debug)]
pub struct AppModuleBusClient {
    sender(WsTopicMessage<AppOutWsEvent>),
    receiver(CSIBusEvent<Wrap<Vec<HistoryEvent>>>),
    receiver(CSIBusEvent<Wrap<WalletEvent>>),
}
}

#[derive(Debug, Clone)]
pub struct Wrap<T>(pub T);

impl<T> BusMessage for Wrap<T> {}

impl Module for WalletModule {
    type Context = Arc<WalletModuleCtx>;

    async fn build(bus: SharedMessageBus, ctx: Self::Context) -> Result<Self> {
        let state = RouterCtx {
            wallet_cn: ctx.wallet_cn.clone(),
        };

        // Create a CORS middleware
        let cors = CorsLayer::new()
            .allow_origin(Any) // Allow all origins (can be restricted)
            .allow_methods(vec![Method::GET, Method::POST]) // Allow necessary methods
            .allow_headers(Any); // Allow all headers

        let api = Router::new()
            .route("/_health", get(health))
            .route("/api/config", get(get_config))
            .with_state(state)
            .layer(cors); // Apply the CORS middleware

        if let Ok(mut guard) = ctx.api.router.lock() {
            if let Some(router) = guard.take() {
                guard.replace(router.merge(api));
            }
        }
        let bus = AppModuleBusClient::new_from_bus(bus.new_handle()).await;

        Ok(WalletModule { bus })
    }

    async fn run(&mut self) -> Result<()> {
        module_handle_messages! {
            on_self self,
            listen <CSIBusEvent<Wrap<Vec<HistoryEvent>>>> event => {
                for msg in event.event.0 {
                    self.bus.send(WsTopicMessage::new(
                        msg.account.0.clone(),
                        AppOutWsEvent::TxEvent(msg),
                    ))?;
                }
            }
            listen<CSIBusEvent<Wrap<WalletEvent>>> event => {
                self.bus.send(WsTopicMessage::new(
                    event.event.0.account.0.clone(),
                    AppOutWsEvent::WalletEvent {
                        account: event.event.0.account.0.clone(),
                        event:event.event.0.program_outputs
                    },
                ))?;
            }
        };

        Ok(())
    }
}

#[derive(Clone)]
struct RouterCtx {
    pub wallet_cn: ContractName,
}

async fn health() -> impl IntoResponse {
    Json("OK")
}

#[derive(Serialize)]
struct ConfigResponse {
    contract_name: String,
}

// --------------------------------------------------------
//     Routes
// --------------------------------------------------------

async fn get_config(State(ctx): State<RouterCtx>) -> impl IntoResponse {
    Json(ConfigResponse {
        contract_name: ctx.wallet_cn.0,
    })
}
