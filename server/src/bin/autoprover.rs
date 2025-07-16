use std::{
    env,
    sync::{Arc, Mutex},
};

use anyhow::{Context, Result};
use axum::Router;
use clap::Parser;
use client_sdk::rest_client::NodeApiHttpClient;
use hyle_modules::{
    bus::{metrics::BusMetrics, SharedMessageBus},
    modules::{
        admin::{AdminApi, AdminApiRunContext},
        da_listener::{DAListener, DAListenerConf},
        prover::{AutoProver, AutoProverCtx},
        rest::{RestApi, RestApiRunContext},
        BuildApiContextInner, ModulesHandler,
    },
    utils::logger::setup_tracing,
};
use prometheus::Registry;
use sdk::{api::NodeInfo, info, ContractName};
use secp256k1::{PublicKey, Secp256k1, SecretKey};
use server::conf::Conf;
use wallet::client::tx_executor_handler::{Wallet, WalletConstructor};

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
pub struct Args {
    #[arg(long, default_value = "config.toml")]
    pub config_file: Vec<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let config = Conf::new(args.config_file).context("reading config file")?;
    setup_tracing(
        &config.log_format,
        format!("{}(autoprover)", config.id.clone(),),
    )
    .context("setting up tracing")?;
    let config = Arc::new(config);
    info!("Starting autoprover with config: {:?}", &config);

    let node_client =
        Arc::new(NodeApiHttpClient::new(config.node_url.clone()).context("build node client")?);

    let bus = SharedMessageBus::new(BusMetrics::global(config.id.clone()));
    std::fs::create_dir_all(&config.data_directory).context("creating data directory")?;

    let registry = Registry::new();
    let provider = opentelemetry_sdk::metrics::SdkMeterProvider::builder()
        .with_reader(
            opentelemetry_prometheus::exporter()
                .with_registry(registry.clone())
                .build()
                .context("starting prometheus exporter")?,
        )
        .build();
    opentelemetry::global::set_meter_provider(provider.clone());

    let mut handler = ModulesHandler::new(&bus).await;
    let api_ctx = Arc::new(BuildApiContextInner {
        router: Mutex::new(Some(Router::new())),
        openapi: Default::default(),
    });

    // This module connects to the da_address and receives all the blocks
    handler
        .build_module::<DAListener>(DAListenerConf {
            start_block: None,
            data_directory: config.data_directory.clone(),
            da_read_from: config.da_read_from.clone(),
            timeout_client_secs: 10,
        })
        .await?;

    // Ajout de l'autoprover du wallet
    let wallet_cn: ContractName = "wallet".into();

    let secp = Secp256k1::new();
    let secret_key =
        hex::decode(env::var("INVITE_CODE_PKEY").unwrap_or(
            "0000000000000001000000000000000100000000000000010000000000000001".to_string(),
        ))
        .expect("INVITE_CODE_PKEY must be a hex string");
    let secret_key = SecretKey::from_byte_array(secret_key.try_into().expect("32 bytes"))
        .expect("32 bytes, within curve order");
    let public_key = PublicKey::from_secret_key(&secp, &secret_key);

    let hyli_password = env::var("HYLI_PASSWORD").unwrap_or("hylisecure".to_string());
    let dumped_wallet_json =
        std::fs::read_to_string("./dumped_wallet.json").context("reading dumped_wallet.json")?;
    let dumped_wallet = serde_json::from_str::<Wallet>(&dumped_wallet_json)
        .context("parsing dumped_wallet.json")?
        .clone();

    let wallet_constructor =
        WalletConstructor::new(hyli_password, public_key.serialize(), Some(dumped_wallet));
    let wallet = Wallet::new(&Some(wallet_constructor.clone())).expect("must succeed");

    handler
        .build_module::<AutoProver<Wallet>>(Arc::new(AutoProverCtx {
            data_directory: config.data_directory.clone(),
            prover: Arc::new(client_sdk::helpers::risc0::Risc0Prover::new(
                contracts::WALLET_ELF,
            )),
            contract_name: wallet_cn,
            node: node_client.clone(),
            default_state: wallet,
            api: Some(api_ctx.clone()),
            buffer_blocks: config.wallet_buffer_blocks,
            max_txs_per_proof: config.wallet_max_txs_per_proof,
            tx_working_window_size: config.wallet_tx_working_window_size,
        }))
        .await?;

    handler
        .build_module::<AdminApi>(AdminApiRunContext::new(
            config.admin_server_port,
            Router::new(),
            config.admin_server_max_body_size,
            config.data_directory.clone(),
        ))
        .await?;

    // REST API
    let router = api_ctx
        .router
        .lock()
        .expect("Context router should be available.")
        .take()
        .unwrap_or_default();
    let openapi = api_ctx
        .openapi
        .lock()
        .expect("OpenAPI should be available")
        .clone();
    handler
        .build_module::<RestApi>(RestApiRunContext {
            port: config.rest_server_port,
            max_body_size: config.rest_server_max_body_size,
            registry,
            router,
            openapi,
            info: NodeInfo {
                id: config.id.clone(),
                da_address: config.da_read_from.clone(),
                pubkey: None,
            },
        })
        .await?;

    handler.start_modules().await?;
    handler.exit_process().await?;

    Ok(())
}
