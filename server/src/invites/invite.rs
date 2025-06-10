use anyhow::Result;
use axum::http::StatusCode;
use axum::{extract::State, routing::post, Json, Router};
use chrono::NaiveDateTime;
use hyle_modules::modules::BuildApiContextInner;
use hyle_modules::{
    bus::SharedMessageBus, module_bus_client, module_handle_messages, modules::Module,
};
use sdk::verifiers::Secp256k1Blob;
use sdk::{Blob, Identity};
use secp256k1::{Message, PublicKey, Secp256k1, SecretKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgPoolOptions, FromRow, Pool};
use std::env;
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
pub struct InviteCode {
    pub id: i32,
    pub code: String,
    pub wallet: Option<String>,
    pub used_at: Option<NaiveDateTime>,
}

#[derive(Debug, Deserialize)]
pub struct ConsumeInviteBody {
    pub code: String,
    pub wallet: String,
}

impl InviteModuleInner {
    async fn consume_invite(&self, code: &str, wallet: &str) -> Result<Blob> {
        let invite: Option<InviteCode> = sqlx::query_as(
            "
            UPDATE invite_codes
            SET used_at = NOW(), wallet = $2
            WHERE id = (
                SELECT id FROM invite_codes
                WHERE code = $1 AND used_at IS NULL and wallet IS NULL
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING id, code, wallet, used_at
            ",
        )
        .bind(code)
        .bind(wallet)
        .fetch_optional(&self.pool)
        .await?;

        if invite.is_none() {
            return Err(anyhow::anyhow!("Invite code not found or already used"));
        }

        tracing::info!("Invite code consumed: {}", code);
        // Let's create a secp2561k1 blob signing the data
        let identity = Identity::new(format!("{}@wallet", wallet));
        let data = format!("Invite - {} for {}", code, wallet);
        let mut hasher = Sha256::new();
        hasher.update(data.clone());
        let message_hash: [u8; 32] = hasher.finalize().into();
        let signature = self
            .crypto
            .secp
            .sign_ecdsa(Message::from_digest(message_hash), &self.crypto.secret_key);

        Ok(Secp256k1Blob::new(
            identity,
            data.as_bytes(),
            &self.crypto.public_key.to_string(),
            &signature.to_string(),
        )?
        .as_blob())
    }
}

async fn route_consume_invite(
    State(ctx): State<Arc<InviteModuleInner>>,
    Json(body): Json<ConsumeInviteBody>,
) -> Result<Json<Blob>, StatusCode> {
    match ctx.consume_invite(&body.code, &body.wallet).await {
        Ok(invite) => Ok(Json(invite)),
        Err(e) => {
            tracing::error!("Error consuming invite: {:?}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub struct CryptoContext {
    pub secp: secp256k1::Secp256k1<secp256k1::All>,
    pub secret_key: secp256k1::SecretKey,
    pub public_key: secp256k1::PublicKey,
}

pub struct InviteModule {
    pub bus: InviteModuleBusClient,
    #[allow(unused)]
    pub inner: Arc<InviteModuleInner>,
}

pub struct InviteModuleInner {
    pub pool: Pool<sqlx::Postgres>,
    pub crypto: CryptoContext,
}

#[derive(Clone)]
pub struct InviteModuleCtx {
    pub db_url: String,
    pub api_ctx: Arc<BuildApiContextInner>,
}

module_bus_client! {
#[derive(Debug)]
pub struct InviteModuleBusClient {
}
}

impl Module for InviteModule {
    type Context = InviteModuleCtx;

    async fn build(bus: SharedMessageBus, ctx: Self::Context) -> Result<Self> {
        let db = PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(5))
            .connect(&ctx.db_url)
            .await?;

        sqlx::query(
            r#"CREATE TABLE IF NOT EXISTS invite_codes (
                id SERIAL PRIMARY KEY,
                code TEXT NOT NULL,
                wallet TEXT,
                used_at TIMESTAMP NULL
            )"#,
        )
        .execute(&db)
        .await?;

        let secp = Secp256k1::new();
        let secret_key = hex::decode(env::var("INVITE_CODE_PKEY").unwrap_or(
            "0000000000000001000000000000000100000000000000010000000000000001".to_string(),
        ))
        .expect("INVITE_CODE_PKEY must be a hex string");
        let secret_key = SecretKey::from_slice(&secret_key).expect("32 bytes, within curve order");
        let public_key = PublicKey::from_secret_key(&secp, &secret_key);

        // If we're using the default private key, add some invite codes.
        if hex::decode("0000000000000001000000000000000100000000000000010000000000000001").unwrap()
            == secret_key.secret_bytes()
        {
            tracing::warn!("Adding default invite codes, this is not secure for production!");
            let invite_codes = vec!["TOTO", "TOTO", "TOTO", "HYLI", "GORANGE", "vip", "vip"];
            for code in invite_codes {
                sqlx::query("INSERT INTO invite_codes (code) VALUES ($1)")
                    .bind(code)
                    .execute(&db)
                    .await?;
            }
        }

        tracing::info!(
            "Invite module initialized with public key: {:?}",
            public_key.serialize()
        );

        let inner = Arc::new(InviteModuleInner {
            pool: db,
            crypto: CryptoContext {
                secp,
                secret_key,
                public_key,
            },
        });

        let api = Router::new().route(
            "/api/consume_invite",
            post(route_consume_invite).with_state(inner.clone()),
        );

        if let Ok(mut guard) = ctx.api_ctx.router.lock() {
            if let Some(router) = guard.take() {
                guard.replace(router.merge(api));
            }
        }

        Ok(Self {
            bus: InviteModuleBusClient::new_from_bus(bus.new_handle()).await,
            inner,
        })
    }

    async fn run(&mut self) -> Result<()> {
        module_handle_messages! {
            on_bus self.bus,
        };
        Ok(())
    }
}

pub struct MockInviteModule {
    pub bus: InviteModuleBusClient,
    #[allow(unused)]
    pub inner: Arc<MockInviteModuleInner>,
}

pub struct MockInviteModuleInner {
    pub crypto: CryptoContext,
}

impl MockInviteModuleInner {
    async fn consume_invite(&self, code: &str, wallet: &str) -> Result<Blob> {
        tracing::info!("Invite code consumed: {}", code);
        // Let's create a secp2561k1 blob signing the data
        let identity = Identity::new(format!("{}@wallet", wallet));
        let data = format!("Invite - {} for {}", code, wallet);
        let mut hasher = Sha256::new();
        hasher.update(data.clone());
        let message_hash: [u8; 32] = hasher.finalize().into();
        let signature = self
            .crypto
            .secp
            .sign_ecdsa(Message::from_digest(message_hash), &self.crypto.secret_key);

        Ok(Secp256k1Blob::new(
            identity,
            data.as_bytes(),
            &self.crypto.public_key.to_string(),
            &signature.to_string(),
        )?
        .as_blob())
    }
}

async fn mock_route_consume_invite(
    State(ctx): State<Arc<MockInviteModuleInner>>,
    Json(body): Json<ConsumeInviteBody>,
) -> Result<Json<Blob>, StatusCode> {
    match ctx.consume_invite(&body.code, &body.wallet).await {
        Ok(invite) => Ok(Json(invite)),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

impl Module for MockInviteModule {
    type Context = InviteModuleCtx;

    async fn build(bus: SharedMessageBus, ctx: Self::Context) -> Result<Self> {
        let secp = Secp256k1::new();
        let secret_key = hex::decode(env::var("INVITE_CODE_PKEY").unwrap_or(
            "0000000000000001000000000000000100000000000000010000000000000001".to_string(),
        ))
        .expect("INVITE_CODE_PKEY must be a hex string");
        let secret_key = SecretKey::from_slice(&secret_key).expect("32 bytes, within curve order");
        let public_key = PublicKey::from_secret_key(&secp, &secret_key);

        let inner = Arc::new(MockInviteModuleInner {
            crypto: CryptoContext {
                secp,
                secret_key,
                public_key,
            },
        });
        let api = Router::new().route(
            "/api/consume_invite",
            post(mock_route_consume_invite).with_state(inner.clone()),
        );
        if let Ok(mut guard) = ctx.api_ctx.router.lock() {
            if let Some(router) = guard.take() {
                guard.replace(router.merge(api));
            }
        }
        Ok(Self {
            bus: InviteModuleBusClient::new_from_bus(bus.new_handle()).await,
            inner,
        })
    }

    async fn run(&mut self) -> Result<()> {
        module_handle_messages! {
            on_bus self.bus,
        };
        Ok(())
    }
}
