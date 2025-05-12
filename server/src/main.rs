use anyhow::{Context, Result};
use app::{AppModule, AppModuleCtx, AppOutWsEvent, AppWsInMessage};
use axum::Router;
use clap::Parser;
use client_sdk::{
    helpers::risc0::Risc0Prover,
    rest_client::{IndexerApiHttpClient, NodeApiHttpClient},
};
use history::{HistoryEvent, HyllarHistory};
use hyle_modules::{
    bus::{metrics::BusMetrics, SharedMessageBus},
    modules::{
        contract_state_indexer::{ContractStateIndexer, ContractStateIndexerCtx},
        da_listener::{DAListener, DAListenerConf},
        prover::{AutoProver, AutoProverCtx},
        rest::{RestApi, RestApiRunContext},
        websocket::WebSocketModule,
        BuildApiContextInner, ModulesHandler,
    },
    utils::{conf, logger::setup_tracing},
};

use prometheus::Registry;
use sdk::{api::NodeInfo, info, ContractName, ZkContract};
use std::{env, sync::Arc};
use tracing::error;
use wallet::{client::indexer::WalletEvent, Wallet};

mod app;
mod history;
mod init;

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
pub struct Args {
    #[arg(long, default_value = "config.toml")]
    pub config_file: Option<String>,

    #[arg(long, default_value = "wallet")]
    pub wallet_cn: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let config =
        conf::Conf::new(args.config_file, None, Some(true)).context("reading config file")?;

    setup_tracing(
        &config.log_format,
        format!("{}(nopkey)", config.id.clone(),),
    )
    .context("setting up tracing")?;

    let config = Arc::new(config);

    let contract_name: ContractName = format!(
        "{}-{}",
        args.wallet_cn.clone(),
        &hex::encode(contracts::WALLET_ID)[..5]
    )
    .into();

    info!("Starting app with config: {:?}", &config);

    let node_url = env::var("NODE_URL").unwrap_or_else(|_| "http://localhost:4321".to_string());
    let indexer_url =
        env::var("INDEXER_URL").unwrap_or_else(|_| "http://localhost:4321".to_string());
    let node_client = Arc::new(NodeApiHttpClient::new(node_url).context("build node client")?);
    let indexer_client =
        Arc::new(IndexerApiHttpClient::new(indexer_url).context("build indexer client")?);

    let contracts = vec![init::ContractInit {
        name: contract_name.clone(),
        program_id: contracts::WALLET_ID,
        initial_state: Wallet::default().commit(),
    }];

    match init::init_node(node_client.clone(), indexer_client.clone(), contracts).await {
        Ok(_) => {}
        Err(e) => {
            error!("Error initializing node: {:?}", e);
            return Ok(());
        }
    }
    let bus = SharedMessageBus::new(BusMetrics::global(config.id.clone()));

    std::fs::create_dir_all(&config.data_directory).context("creating data directory")?;

    let mut handler = ModulesHandler::new(&bus).await;

    let build_api_ctx = Arc::new(BuildApiContextInner {
        router: std::sync::Mutex::new(Some(Router::new())),
        openapi: std::sync::Mutex::new(Default::default()),
    });

    let app_ctx = Arc::new(AppModuleCtx {
        node_client,
        wallet_cn: contract_name.clone(),
        api: build_api_ctx.clone(),
    });
    let start_height = app_ctx.node_client.get_block_height().await?;

    handler.build_module::<AppModule>(app_ctx.clone()).await?;

    handler
        .build_module::<ContractStateIndexer<Wallet, WalletEvent>>(ContractStateIndexerCtx {
            contract_name: contract_name.clone(),
            data_directory: config.data_directory.clone(),
            api: build_api_ctx.clone(),
        })
        .await?;
    handler
        .build_module::<ContractStateIndexer<HyllarHistory, Vec<HistoryEvent>>>(
            ContractStateIndexerCtx {
                contract_name: "hyllar".into(),
                data_directory: config.data_directory.clone(),
                api: build_api_ctx.clone(),
            },
        )
        .await?;

    handler
        .build_module::<AutoProver<Wallet>>(Arc::new(AutoProverCtx {
            start_height,
            data_directory: config.data_directory.clone(),
            prover: Arc::new(Risc0Prover::new(contracts::WALLET_ELF)),
            contract_name: contract_name.clone(),
            node: app_ctx.node_client.clone(),
        }))
        .await?;
    handler
        .build_module::<AutoProver<hyle_hyllar::Hyllar>>(Arc::new(AutoProverCtx {
            start_height,
            data_directory: config.data_directory.clone(),
            prover: Arc::new(Risc0Prover::new(
                hyle_hyllar::client::tx_executor_handler::metadata::HYLLAR_ELF,
            )),
            contract_name: "hyllar".into(),
            node: app_ctx.node_client.clone(),
        }))
        .await?;

    handler
        .build_module::<WebSocketModule<AppWsInMessage, AppOutWsEvent>>(
            config.websocket.clone().into(),
        )
        .await?;

    // This module connects to the da_address and receives all the blocks²
    handler
        .build_module::<DAListener>(DAListenerConf {
            data_directory: config.data_directory.clone(),
            da_read_from: config.da_read_from.clone(),
            start_block: None,
        })
        .await?;

    // Should come last so the other modules have nested their own routes.
    #[allow(clippy::expect_used, reason = "Fail on misconfiguration")]
    let router = build_api_ctx
        .router
        .lock()
        .expect("Context router should be available.")
        .take()
        .expect("Context router should be available.");
    #[allow(clippy::expect_used, reason = "Fail on misconfiguration")]
    let openapi = build_api_ctx
        .openapi
        .lock()
        .expect("OpenAPI should be available")
        .clone();

    handler
        .build_module::<RestApi>(RestApiRunContext {
            port: config.rest_server_port,
            max_body_size: config.rest_server_max_body_size,
            registry: Registry::new(),
            router,
            openapi,
            info: NodeInfo {
                id: config.id.clone(),
                da_address: config.da_read_from.clone(),
                pubkey: None,
            },
        })
        .await?;

    #[cfg(unix)]
    {
        use tokio::signal::unix;
        let mut terminate = unix::signal(unix::SignalKind::interrupt())?;
        tokio::select! {
            Err(e) = handler.start_modules() => {
                error!("Error running modules: {:?}", e);
            }
            _ = tokio::signal::ctrl_c() => {
                info!("Ctrl-C received, shutting down");
            }
            _ = terminate.recv() =>  {
                info!("SIGTERM received, shutting down");
            }
        }
        _ = handler.shutdown_modules().await;
    }
    #[cfg(not(unix))]
    {
        tokio::select! {
            Err(e) = handler.start_modules() => {
                error!("Error running modules: {:?}", e);
            }
            _ = tokio::signal::ctrl_c() => {
                info!("Ctrl-C received, shutting down");
            }
        }
        _ = handler.shutdown_modules().await;
    }

    Ok(())
}
