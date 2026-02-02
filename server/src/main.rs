use anyhow::{Context, Result};
use app::{AppOutWsEvent, AppWsInMessage};
use axum::Router;
use clap::Parser;
use client_sdk::{helpers::risc0::Risc0Prover, rest_client::NodeApiHttpClient};
use conf::Conf;
use history::{HistoryEvent, TokenHistory};
use hyli_modules::modules::admin::{AdminApi, AdminApiRunContext};
use hyli_modules::{
    bus::{metrics::BusMetrics, SharedMessageBus},
    modules::{
        block_processor::NodeStateBlockProcessor,
        contract_state_indexer::{ContractStateIndexer, ContractStateIndexerCtx},
        da_listener::{DAListenerConf, SignedDAListener},
        prover::{AutoProver, AutoProverCtx},
        rest::{RestApi, RestApiRunContext},
        websocket::WebSocketModule,
        BuildApiContextInner, ModulesHandler,
    },
    utils::logger::setup_tracing,
};
use hyli_smt_token::client::tx_executor_handler::SmtTokenProvableState;
use sdk::{api::NodeInfo, info, ContractName};
use server::new_wallet;
use std::sync::{Arc, Mutex};

use crate::sdk_wallet::SdkWalletConfig;

use crate::app::Wrap;

mod app;
mod conf;
mod history;
mod init;
mod sdk_wallet;
mod signing;
mod invites {
    pub mod invite;
}

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
pub struct Args {
    #[arg(long, default_value = "config.toml")]
    pub config_file: Vec<String>,

    #[arg(long, default_value = "wallet")]
    pub wallet_cn: String,

    #[arg(short, long, default_value = "false")]
    pub mock_invites: bool,

    #[arg(short, long, default_value = "false")]
    pub wallet_auto_prover: bool,

    #[arg(short, long, default_value = "false")]
    pub auto_provers: bool,

    #[arg(long, default_value = "false")]
    pub noinit: bool,

    /// Clean the data directory before starting the server
    /// Argument used by hylix tests & run commands
    #[arg(long, default_value = "false")]
    pub clean_data_directory: bool,

    /// Server port (overrides config)
    /// Argument used by hylix tests commands
    #[arg(long)]
    pub server_port: Option<u16>,
}

fn main() -> Result<()> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        // Results in poor threading performance otherwise.
        .disable_lifo_slot()
        .build()
        .context("building tokio runtime")?;
    runtime.block_on(actual_main())
}

async fn actual_main() -> Result<()> {
    let args = Args::parse();
    let config = Conf::new(args.config_file).context("reading config file")?;

    setup_tracing(
        &config.log_format,
        format!("{}(nopkey)", config.id.clone(),),
    )
    .context("setting up tracing")?;

    let config = Arc::new(config);

    if args.clean_data_directory && std::fs::exists(&config.data_directory).unwrap_or(false) {
        info!("Cleaning data directory: {:?}", &config.data_directory);
        std::fs::remove_dir_all(&config.data_directory).context("cleaning data directory")?;
    }

    let registry = hyli_modules::telemetry::init_prometheus_registry_meter_provider()
        .context("starting prometheus exporter")?;

    info!("Starting app with config: {:?}", &config);

    let node_client =
        Arc::new(NodeApiHttpClient::new(config.node_url.clone()).context("build node client")?);

    let wallet_cn: ContractName = args.wallet_cn.clone().into();

    let bus = SharedMessageBus::new(BusMetrics::global());

    std::fs::create_dir_all(&config.data_directory).context("creating data directory")?;

    let mut handler = ModulesHandler::new(&bus, config.data_directory.clone()).await;

    let api_ctx = Arc::new(BuildApiContextInner {
        router: Mutex::new(Some(Router::new())),
        openapi: Default::default(),
    });

    sdk_wallet::setup_wallet_modules(
        &SdkWalletConfig {
            wallet_cn: wallet_cn.clone(),
            noinit: args.noinit,
            data_directory: config.data_directory.clone(),
            auto_prove: args.wallet_auto_prover,
            wallet_buffer_blocks: config.wallet_buffer_blocks,
            wallet_max_txs_per_proof: config.wallet_max_txs_per_proof,
            wallet_tx_working_window_size: config.wallet_tx_working_window_size,
        },
        &mut handler,
        api_ctx.clone(),
        node_client.clone(),
    )
    .await
    .context("initializing wallet modules")?;

    handler
        .build_module::<ContractStateIndexer<TokenHistory, Wrap<Vec<HistoryEvent>>>>(
            ContractStateIndexerCtx {
                contract_name: "oranj".into(),
                data_directory: config.data_directory.clone(),
                api: api_ctx.clone(),
            },
        )
        .await?;
    handler
        .build_module::<ContractStateIndexer<TokenHistory, Wrap<Vec<HistoryEvent>>>>(
            ContractStateIndexerCtx {
                contract_name: "vitamin".into(),
                data_directory: config.data_directory.clone(),
                api: api_ctx.clone(),
            },
        )
        .await?;
    handler
        .build_module::<ContractStateIndexer<TokenHistory, Wrap<Vec<HistoryEvent>>>>(
            ContractStateIndexerCtx {
                contract_name: "oxygen".into(),
                data_directory: config.data_directory.clone(),
                api: api_ctx.clone(),
            },
        )
        .await?;

    handler
        .build_module::<WebSocketModule<AppWsInMessage, AppOutWsEvent>>(config.websocket.clone())
        .await?;

    // This module connects to the da_address and receives all the blocks
    handler
        .build_module::<SignedDAListener<NodeStateBlockProcessor>>(DAListenerConf {
            start_block: None,
            data_directory: config.data_directory.clone(),
            da_read_from: config.da_read_from.clone(),
            da_fallback_addresses: vec![],
            timeout_client_secs: 10,
            processor_config: (),
        })
        .await?;

    if args.auto_provers {
        handler
            .build_module::<AutoProver<SmtTokenProvableState, Risc0Prover>>(Arc::new(
                AutoProverCtx {
                    data_directory: config.data_directory.clone(),
                    prover: Arc::new(Risc0Prover::new(
                        hyli_smt_token::client::tx_executor_handler::metadata::SMT_TOKEN_ELF
                            .to_vec(),
                        hyli_smt_token::client::tx_executor_handler::metadata::PROGRAM_ID,
                    )),
                    contract_name: "oranj".into(),
                    node: node_client.clone(),
                    default_state: Default::default(),
                    buffer_blocks: config.smt_buffer_blocks,
                    max_txs_per_proof: config.smt_max_txs_per_proof,
                    tx_working_window_size: config.smt_tx_working_window_size,
                    api: None,
                },
            ))
            .await?;
        handler
            .build_module::<AutoProver<SmtTokenProvableState, Risc0Prover>>(Arc::new(
                AutoProverCtx {
                    data_directory: config.data_directory.clone(),
                    prover: Arc::new(Risc0Prover::new(
                        hyli_smt_token::client::tx_executor_handler::metadata::SMT_TOKEN_ELF
                            .to_vec(),
                        hyli_smt_token::client::tx_executor_handler::metadata::PROGRAM_ID,
                    )),
                    contract_name: "vitamin".into(),
                    node: node_client.clone(),
                    default_state: Default::default(),
                    buffer_blocks: config.smt_buffer_blocks,
                    max_txs_per_proof: config.smt_max_txs_per_proof,
                    tx_working_window_size: config.smt_tx_working_window_size,
                    api: None,
                },
            ))
            .await?;
        handler
            .build_module::<AutoProver<SmtTokenProvableState, Risc0Prover>>(Arc::new(
                AutoProverCtx {
                    data_directory: config.data_directory.clone(),
                    prover: Arc::new(Risc0Prover::new(
                        hyli_smt_token::client::tx_executor_handler::metadata::SMT_TOKEN_ELF
                            .to_vec(),
                        hyli_smt_token::client::tx_executor_handler::metadata::PROGRAM_ID,
                    )),
                    contract_name: "oxygen".into(),
                    node: node_client.clone(),
                    default_state: Default::default(),
                    buffer_blocks: config.smt_buffer_blocks,
                    max_txs_per_proof: config.smt_max_txs_per_proof,
                    tx_working_window_size: config.smt_tx_working_window_size,
                    api: None,
                },
            ))
            .await?;
    }

    if args.mock_invites {
        handler
            .build_module::<invites::invite::MockInviteModule>(invites::invite::InviteModuleCtx {
                db_url: config.db_url.clone(),
                api_ctx: api_ctx.clone(),
            })
            .await?;
    } else {
        handler
            .build_module::<invites::invite::InviteModule>(invites::invite::InviteModuleCtx {
                db_url: config.db_url.clone(),
                api_ctx: api_ctx.clone(),
            })
            .await?;
    }

    // Signing module for QR code signing flow with mobile apps
    handler
        .build_module::<signing::SigningModule>(signing::SigningModuleCtx {
            api_ctx: api_ctx.clone(),
        })
        .await?;

    handler
        .build_module::<AdminApi>(AdminApiRunContext::new(
            config.admin_server_port,
            Router::new(),
            config.admin_server_max_body_size,
            config.data_directory.clone(),
        ))
        .await?;

    // Should come last so the other modules have nested their own routes.
    #[allow(clippy::expect_used, reason = "Fail on misconfiguration")]
    let router = api_ctx
        .router
        .lock()
        .expect("Context router should be available.")
        .take()
        .expect("Context router should be available.");
    #[allow(clippy::expect_used, reason = "Fail on misconfiguration")]
    let openapi = api_ctx
        .openapi
        .lock()
        .expect("OpenAPI should be available")
        .clone();

    handler
        .build_module::<RestApi>(RestApiRunContext {
            port: args.server_port.unwrap_or(config.rest_server_port),
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
