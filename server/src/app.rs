use std::{sync::Arc, time::Duration};

use anyhow::Result;
use axum::{
    extract::{Json, State},
    http::{HeaderMap, Method, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use client_sdk::rest_client::NodeApiHttpClient;
use hyle::{
    bus::{BusClientReceiver, BusMessage, SharedMessageBus},
    model::CommonRunContext,
    module_handle_messages,
    rest::AppError,
    utils::modules::{module_bus_client, Module},
};
use wallet::WalletAction;

use sdk::{BlobTransaction, ContractName, TxHash};
use serde::Serialize;
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};

pub struct AppModule {
    bus: AppModuleBusClient,
}

pub struct AppModuleCtx {
    pub common: Arc<CommonRunContext>,
    pub node_client: Arc<NodeApiHttpClient>,
    pub wallet_cn: ContractName,
}

#[derive(Debug, Clone)]
pub enum AppEvent {
    SequencedTx(TxHash),
    FailedTx(TxHash, String),
}
impl BusMessage for AppEvent {}

module_bus_client! {
#[derive(Debug)]
pub struct AppModuleBusClient {
    receiver(AppEvent),
}
}

impl Module for AppModule {
    type Context = Arc<AppModuleCtx>;

    async fn build(ctx: Self::Context) -> Result<Self> {
        let state = RouterCtx {
            wallet_cn: ctx.wallet_cn.clone(),
            app: Arc::new(Mutex::new(HyleOofCtx {
                bus: ctx.common.bus.new_handle(),
            })),
            client: ctx.node_client.clone(),
        };

        // Créer un middleware CORS
        let cors = CorsLayer::new()
            .allow_origin(Any) // Permet toutes les origines (peut être restreint)
            .allow_methods(vec![Method::GET, Method::POST]) // Permet les méthodes nécessaires
            .allow_headers(Any); // Permet tous les en-têtes

        let api = Router::new()
            .route("/_health", get(health))
            .route("/api/config", get(get_config))
            .with_state(state)
            .layer(cors); // Appliquer le middleware CORS

        if let Ok(mut guard) = ctx.common.router.lock() {
            if let Some(router) = guard.take() {
                guard.replace(router.merge(api));
            }
        }
        let bus = AppModuleBusClient::new_from_bus(ctx.common.bus.new_handle()).await;

        Ok(AppModule { bus })
    }

    async fn run(&mut self) -> Result<()> {
        module_handle_messages! {
            on_bus self.bus,
        };

        Ok(())
    }
}

#[derive(Clone)]
struct RouterCtx {
    pub app: Arc<Mutex<HyleOofCtx>>,
    pub client: Arc<NodeApiHttpClient>,
    pub wallet_cn: ContractName,
}

pub struct HyleOofCtx {
    pub bus: SharedMessageBus,
}

async fn health() -> impl IntoResponse {
    Json("OK")
}

// --------------------------------------------------------
//     Headers
// --------------------------------------------------------

const USER_HEADER: &str = "x-user";
const SESSION_KEY_HEADER: &str = "x-session-key";
const SIGNATURE_HEADER: &str = "x-request-signature";

#[derive(Debug)]
struct AuthHeaders {
    session_key: String,
    signature: String,
    user: String,
}

impl AuthHeaders {
    fn from_headers(headers: &HeaderMap) -> Result<Self, AppError> {
        let session_key = headers
            .get(SESSION_KEY_HEADER)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| {
                AppError(
                    StatusCode::UNAUTHORIZED,
                    anyhow::anyhow!("Missing session key"),
                )
            })?;

        let signature = headers
            .get(SIGNATURE_HEADER)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| {
                AppError(
                    StatusCode::UNAUTHORIZED,
                    anyhow::anyhow!("Missing signature"),
                )
            })?;

        let user = headers
            .get(USER_HEADER)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| {
                AppError(
                    StatusCode::UNAUTHORIZED,
                    anyhow::anyhow!("Missing signature"),
                )
            })?;

        Ok(AuthHeaders {
            session_key: session_key.to_string(),
            signature: signature.to_string(),
            user: user.to_string(),
        })
    }
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
