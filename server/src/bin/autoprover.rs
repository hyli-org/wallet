use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::{Context, Result};
use axum::Router;
use clap::Parser;
use client_sdk::{helpers::risc0::Risc0Prover, rest_client::NodeApiHttpClient};
use hyli_modules::{
    bus::SharedMessageBus,
    modules::{
        admin::{AdminApi, AdminApiRunContext},
        contract_listener::{ContractListener, ContractListenerConf},
        prover::{AutoProver, AutoProverCtx},
        rest::{RestApi, RestApiRunContext},
        BuildApiContextInner, ModulesHandler,
    },
    utils::logger::setup_tracing,
};
use sdk::{api::NodeInfo, info, ContractName};
use server::{conf::Conf, new_wallet};
use wallet::client::tx_executor_handler::Wallet;

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

    let bus = SharedMessageBus::new();
    std::fs::create_dir_all(&config.data_directory).context("creating data directory")?;

    let mut handler = ModulesHandler::new(&bus, config.data_directory.clone())?;
    let api_ctx = Arc::new(BuildApiContextInner {
        router: Mutex::new(Some(Router::new())),
        openapi: Default::default(),
    });

    // Ajout de l'autoprover du wallet
    let wallet_cn: ContractName = "wallet".into();
    let (_, wallet) = new_wallet(&wallet_cn);

    handler
        .build_module::<ContractListener>(ContractListenerConf {
            database_url: config.indexer_database_url.clone(),
            data_directory: config.data_directory.clone(),
            contracts: HashSet::from([wallet_cn.clone()]),
            poll_interval: Duration::from_secs(config.auto_prover_listener_poll_interval_secs),
            replay_settled_from_start: true,
        })
        .await?;
    handler
        .build_module::<AutoProver<Wallet, Risc0Prover>>(Arc::new(AutoProverCtx {
            data_directory: config.data_directory.clone(),
            prover: Arc::new(client_sdk::helpers::risc0::Risc0Prover::new(
                contracts::WALLET_ELF.to_vec(),
                contracts::WALLET_ID,
            )),
            contract_name: wallet_cn,
            node: node_client.clone(),
            default_state: wallet,
            api: Some(api_ctx.clone()),
            max_txs_per_proof: config.wallet_max_txs_per_proof,
            tx_working_window_size: config.wallet_tx_working_window_size,
            idle_flush_interval: Duration::from_secs(config.auto_prover_idle_flush_interval_secs),
            tx_buffer_size: config.auto_prover_tx_buffer_size,
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
