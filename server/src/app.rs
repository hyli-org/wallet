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
use hyle_modules::{
    bus::{BusClientSender, SharedMessageBus},
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

pub struct AppModule {
    bus: AppModuleBusClient,
}

pub struct AppModuleCtx {
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
    receiver(CSIBusEvent<Vec<HistoryEvent>>),
    receiver(CSIBusEvent<WalletEvent>),
}
}

impl Module for AppModule {
    type Context = Arc<AppModuleCtx>;

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

        Ok(AppModule { bus })
    }

    async fn run(&mut self) -> Result<()> {
        module_handle_messages! {
            on_bus self.bus,
            listen <CSIBusEvent<Vec<HistoryEvent>>> event => {
                for msg in event.event {
                    self.bus.send(WsTopicMessage::new(
                        msg.account.0.clone(),
                        AppOutWsEvent::TxEvent(msg),
                    ))?;
                }
            }
            listen<CSIBusEvent<WalletEvent>> event => {
                self.bus.send(WsTopicMessage::new(
                    event.event.account.0.clone(),
                    AppOutWsEvent::WalletEvent {
                        account: event.event.account.0.clone(),
                        event:event.event.program_outputs
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

// async fn increment(
//     State(ctx): State<RouterCtx>,
//     headers: HeaderMap,
// ) -> Result<impl IntoResponse, AppError> {
//     let auth = AuthHeaders::from_headers(&headers)?;
//     send(ctx.clone(), auth).await
// }

async fn get_config(State(ctx): State<RouterCtx>) -> impl IntoResponse {
    Json(ConfigResponse {
        contract_name: ctx.wallet_cn.0,
    })
}

// async fn send(ctx: RouterCtx, auth: AuthHeaders) -> Result<impl IntoResponse, AppError> {
//     let _header_session_key = auth.session_key.clone();
//     let _header_signature = auth.signature.clone();
//     let identity = auth.user.clone();
//
//     let action_wallet = WalletAction::Increment;
//
//     let blobs = vec![action_wallet.as_blob(ctx.wallet_cn.clone())];
//
//     let res = ctx
//         .client
//         .send_tx_blob(&BlobTransaction::new(identity.clone(), blobs))
//         .await;
//
//     if let Err(ref e) = res {
//         let root_cause = e.root_cause().to_string();
//         return Err(AppError(
//             StatusCode::BAD_REQUEST,
//             anyhow::anyhow!("{}", root_cause),
//         ));
//     }
//
//     let tx_hash = res.unwrap();
//
//     let mut bus = {
//         let app = ctx.app.lock().await;
//         AppModuleBusClient::new_from_bus(app.bus.new_handle()).await
//     };
//
//     tokio::time::timeout(Duration::from_secs(5), async {
//         loop {
//             let a = bus.recv().await?;
//             match a {
//                 AppEvent::SequencedTx(sequenced_tx_hash) => {
//                     if sequenced_tx_hash == tx_hash {
//                         return Ok(Json(sequenced_tx_hash));
//                     }
//                 }
//                 AppEvent::FailedTx(sequenced_tx_hash, error) => {
//                     if sequenced_tx_hash == tx_hash {
//                         return Err(AppError(StatusCode::BAD_REQUEST, anyhow::anyhow!(error)));
//                     }
//                 }
//             }
//         }
//     })
//     .await?
// }
