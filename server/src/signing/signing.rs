use anyhow::Result;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use futures::{SinkExt, StreamExt};
use hyli_modules::{
    bus::SharedMessageBus, module_bus_client, module_handle_messages, modules::Module,
    modules::BuildApiContextInner,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::Arc,
    time::Duration,
};
use tokio::sync::{mpsc, RwLock};

/// Timeout for pending signing requests (2 minutes)
const REQUEST_TIMEOUT_SECS: u64 = 120;

// WebSocket message types from clients
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsInMessage {
    /// Web wallet registering a signing request
    RegisterSigningRequest {
        #[serde(rename = "requestId")]
        request_id: String,
        message: String,      // hex-encoded message to sign
        description: String,
        origin: String,
    },
    /// Web wallet canceling a request
    CancelSigningRequest {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    /// Mobile app submitting a signature
    SubmitSignature {
        #[serde(rename = "requestId")]
        request_id: String,
        signature: String,    // 64 bytes hex
        #[serde(rename = "publicKey")]
        public_key: String,   // 33 bytes hex (compressed secp256k1)
        /// Optional username from the mobile app's wallet
        #[serde(default)]
        username: Option<String>,
    },
}

// WebSocket message types to clients
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsOutMessage {
    /// Acknowledge receipt of signing request
    SigningRequestAck {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    /// Signature received from mobile app
    SigningResponse {
        #[serde(rename = "requestId")]
        request_id: String,
        signature: String,
        #[serde(rename = "publicKey")]
        public_key: String,
        /// Optional username from the mobile app's wallet
        #[serde(skip_serializing_if = "Option::is_none")]
        username: Option<String>,
    },
    /// Error occurred
    SigningError {
        #[serde(rename = "requestId")]
        request_id: String,
        error: String,
    },
}

/// A pending signing request waiting for mobile app signature
struct PendingRequest {
    request_id: String,
    message: String,
    description: String,
    origin: String,
    /// Channel to send response back to web wallet
    response_tx: mpsc::Sender<WsOutMessage>,
    created_at: std::time::Instant,
}

/// Shared state for the signing service
pub struct SigningModuleInner {
    /// Pending signing requests indexed by request_id
    pending_requests: RwLock<HashMap<String, PendingRequest>>,
}

impl SigningModuleInner {
    fn new() -> Self {
        Self {
            pending_requests: RwLock::new(HashMap::new()),
        }
    }

    /// Register a new signing request from web wallet
    async fn register_request(
        &self,
        request_id: String,
        message: String,
        description: String,
        origin: String,
        response_tx: mpsc::Sender<WsOutMessage>,
    ) {
        let mut requests = self.pending_requests.write().await;
        requests.insert(
            request_id.clone(),
            PendingRequest {
                request_id: request_id.clone(),
                message,
                description,
                origin,
                response_tx,
                created_at: std::time::Instant::now(),
            },
        );
    }

    /// Cancel a pending signing request
    async fn cancel_request(&self, request_id: &str) {
        let mut requests = self.pending_requests.write().await;
        requests.remove(request_id);
    }

    /// Submit a signature from mobile app
    async fn submit_signature(
        &self,
        request_id: &str,
        signature: String,
        public_key: String,
        username: Option<String>,
    ) -> Result<(), String> {
        let mut requests = self.pending_requests.write().await;

        if let Some(pending) = requests.remove(request_id) {
            let response = WsOutMessage::SigningResponse {
                request_id: request_id.to_string(),
                signature,
                public_key,
                username: username.clone(),
            };

            // Send response to web wallet
            match pending.response_tx.send(response).await {
                Ok(()) => Ok(()),
                Err(_) => Err("Failed to send response to web wallet".to_string()),
            }
        } else {
            Err(format!("Request {} not found or expired", request_id))
        }
    }

    /// Clean up expired requests
    async fn cleanup_expired(&self) {
        let mut requests = self.pending_requests.write().await;
        let timeout = Duration::from_secs(REQUEST_TIMEOUT_SECS);

        requests.retain(|_, req| {
            let expired = req.created_at.elapsed() >= timeout;
            if expired {
                // Try to notify the web wallet about timeout
                let _ = req.response_tx.try_send(WsOutMessage::SigningError {
                    request_id: req.request_id.clone(),
                    error: "Request timed out".to_string(),
                });
            }
            !expired
        });
    }
}

/// Handle a WebSocket connection
async fn handle_ws(ws: WebSocket, state: Arc<SigningModuleInner>) {
    let (mut ws_sender, mut ws_receiver) = ws.split();

    // Channel for sending messages back to this client
    let (tx, mut rx) = mpsc::channel::<WsOutMessage>(32);

    // Task to forward messages from channel to WebSocket
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if let Ok(json) = serde_json::to_string(&msg) {
                if ws_sender.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
        }
    });

    // Handle incoming messages
    while let Some(msg) = ws_receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                let text_str: &str = &text;
                if let Ok(ws_msg) = serde_json::from_str::<WsInMessage>(text_str) {
                    match ws_msg {
                        WsInMessage::RegisterSigningRequest {
                            request_id,
                            message,
                            description,
                            origin,
                        } => {
                            state
                                .register_request(
                                    request_id.clone(),
                                    message,
                                    description,
                                    origin,
                                    tx.clone(),
                                )
                                .await;

                            // Send acknowledgment
                            let _ = tx
                                .send(WsOutMessage::SigningRequestAck {
                                    request_id,
                                })
                                .await;
                        }
                        WsInMessage::CancelSigningRequest { request_id } => {
                            state.cancel_request(&request_id).await;
                        }
                        WsInMessage::SubmitSignature {
                            request_id,
                            signature,
                            public_key,
                            username,
                        } => {
                            if let Err(e) = state
                                .submit_signature(&request_id, signature, public_key, username)
                                .await
                            {
                                let _ = tx
                                    .send(WsOutMessage::SigningError {
                                        request_id,
                                        error: e,
                                    })
                                    .await;
                            }
                        }
                    }
                }
            }
            Ok(Message::Close(_)) => break,
            Err(_) => break,
            _ => {}
        }
    }

    send_task.abort();
}

/// WebSocket upgrade handler
async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<SigningModuleInner>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

/// HTTP request body for submitting a signature
#[derive(Debug, Deserialize)]
pub struct SubmitSignatureRequest {
    #[serde(rename = "requestId")]
    request_id: String,
    signature: String,
    #[serde(rename = "publicKey")]
    public_key: String,
    /// Optional username from the mobile app's wallet
    #[serde(default)]
    username: Option<String>,
}

/// HTTP response for submitting a signature
#[derive(Debug, Serialize)]
pub struct SubmitSignatureResponse {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// HTTP POST handler for submitting signatures (for mobile apps)
async fn submit_signature_handler(
    State(state): State<Arc<SigningModuleInner>>,
    Json(payload): Json<SubmitSignatureRequest>,
) -> impl IntoResponse {
    match state
        .submit_signature(&payload.request_id, payload.signature, payload.public_key, payload.username)
        .await
    {
        Ok(()) => (
            StatusCode::OK,
            Json(SubmitSignatureResponse {
                success: true,
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(SubmitSignatureResponse {
                success: false,
                error: Some(e),
            }),
        ),
    }
}

pub struct SigningModule {
    pub bus: SigningModuleBusClient,
    #[allow(unused)]
    pub inner: Arc<SigningModuleInner>,
}

#[derive(Clone)]
pub struct SigningModuleCtx {
    pub api_ctx: Arc<BuildApiContextInner>,
}

module_bus_client! {
#[derive(Debug)]
pub struct SigningModuleBusClient {
}
}

impl Module for SigningModule {
    type Context = SigningModuleCtx;

    async fn build(bus: SharedMessageBus, ctx: Self::Context) -> Result<Self> {
        let inner = Arc::new(SigningModuleInner::new());

        // Spawn cleanup task
        let cleanup_inner = inner.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                cleanup_inner.cleanup_expired().await;
            }
        });

        // Add WebSocket route for signing and HTTP POST route for mobile apps
        // POST is available at both /signing and /signing/submit for flexibility
        let api = Router::new()
            .route("/signing", get(ws_handler).post(submit_signature_handler))
            .route("/signing/submit", post(submit_signature_handler))
            .with_state(inner.clone());

        if let Ok(mut guard) = ctx.api_ctx.router.lock() {
            if let Some(router) = guard.take() {
                guard.replace(router.merge(api));
            }
        }

        Ok(Self {
            bus: SigningModuleBusClient::new_from_bus(bus.new_handle()).await,
            inner,
        })
    }

    async fn run(&mut self) -> Result<()> {
        module_handle_messages! {
            on_self self,
        };
        Ok(())
    }
}
