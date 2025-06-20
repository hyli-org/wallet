use anyhow::{Context, Result};
use app::{AppModule, AppModuleCtx, AppOutWsEvent, AppWsInMessage};
use axum::Router;
use clap::Parser;
use client_sdk::transaction_builder::TxExecutorHandler;
use client_sdk::{
    helpers::risc0::Risc0Prover,
    rest_client::{IndexerApiHttpClient, NodeApiHttpClient},
};
use conf::Conf;
use history::{HistoryEvent, TokenHistory};
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
    utils::logger::setup_tracing,
};
use hyle_smt_token::client::tx_executor_handler::SmtTokenProvableState;
use prometheus::Registry;
use sdk::{api::NodeInfo, info, ContractName};
use secp256k1::{PublicKey, Secp256k1, SecretKey};
use std::{
    env,
    sync::{Arc, Mutex},
};
use tracing::error;
use wallet::client::{
    indexer::WalletEvent,
    tx_executor_handler::{Wallet, WalletConstructor},
};

mod app;
mod conf;
mod history;
mod init;
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
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let config = Conf::new(args.config_file).context("reading config file")?;

    setup_tracing(
        &config.log_format,
        format!("{}(nopkey)", config.id.clone(),),
    )
    .context("setting up tracing")?;

    let config = Arc::new(config);

    info!("Starting app with config: {:?}", &config);

    let node_client =
        Arc::new(NodeApiHttpClient::new(config.node_url.clone()).context("build node client")?);
    let indexer_client = Arc::new(
        IndexerApiHttpClient::new(config.indexer_url.clone()).context("build indexer client")?,
    );

    let wallet_cn: ContractName = args.wallet_cn.clone().into();

    let secp = Secp256k1::new();
    let secret_key =
        hex::decode(env::var("INVITE_CODE_PKEY").unwrap_or(
            "0000000000000001000000000000000100000000000000010000000000000001".to_string(),
        ))
        .expect("INVITE_CODE_PKEY must be a hex string");
    let secret_key = SecretKey::from_slice(&secret_key).expect("32 bytes, within curve order");
    let public_key = PublicKey::from_secret_key(&secp, &secret_key);

    let hyli_password = env::var("HYLI_PASSWORD").unwrap_or("hylisecure".to_string());
    let wallet_constructor = WalletConstructor::new(hyli_password, public_key.serialize());
    let wallet = Wallet::new(&Some(wallet_constructor.clone())).expect("must succeed");
    let contracts = vec![init::ContractInit {
        name: wallet_cn.clone(),
        program_id: contracts::WALLET_ID,
        initial_state: wallet.get_state_commitment(),
        constructor_metadata: borsh::to_vec(&wallet_constructor).expect("must succeed"),
    }];

    if args.noinit {
        info!("Skipping initialization, using existing contracts");
    } else {
        match init::init_node(node_client.clone(), indexer_client.clone(), contracts).await {
            Ok(_) => {}
            Err(e) => {
                error!("Error initializing node: {:?}", e);
                return Ok(());
            }
        }
    }
    let bus = SharedMessageBus::new(BusMetrics::global(config.id.clone()));

    std::fs::create_dir_all(&config.data_directory).context("creating data directory")?;

    let registry = Registry::new();
    // Init global metrics meter we expose as an endpoint
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

    let app_ctx = Arc::new(AppModuleCtx {
        api: api_ctx.clone(),
        node_client,
        wallet_cn: wallet_cn.clone(),
    });

    handler.build_module::<AppModule>(app_ctx.clone()).await?;

    handler
        .build_module::<ContractStateIndexer<Wallet, WalletEvent>>(ContractStateIndexerCtx {
            contract_name: wallet_cn.clone(),
            data_directory: config.data_directory.clone(),
            api: api_ctx.clone(),
        })
        .await?;
    handler
        .build_module::<ContractStateIndexer<TokenHistory, Vec<HistoryEvent>>>(
            ContractStateIndexerCtx {
                contract_name: "oranj".into(),
                data_directory: config.data_directory.clone(),
                api: api_ctx.clone(),
            },
        )
        .await?;
    handler
        .build_module::<ContractStateIndexer<TokenHistory, Vec<HistoryEvent>>>(
            ContractStateIndexerCtx {
                contract_name: "vitamin".into(),
                data_directory: config.data_directory.clone(),
                api: api_ctx.clone(),
            },
        )
        .await?;
    handler
        .build_module::<ContractStateIndexer<TokenHistory, Vec<HistoryEvent>>>(
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
        .build_module::<DAListener>(DAListenerConf {
            start_block: None,
            data_directory: config.data_directory.clone(),
            da_read_from: config.da_read_from.clone(),
        })
        .await?;

    if args.wallet_auto_prover {
        // Wallet auto prover
        handler
            .build_module::<AutoProver<Wallet>>(Arc::new(AutoProverCtx {
                data_directory: config.data_directory.clone(),
                prover: Arc::new(Risc0Prover::new(contracts::WALLET_ELF)),
                contract_name: wallet_cn.clone(),
                node: app_ctx.node_client.clone(),
                default_state: wallet.clone(),
                buffer_blocks: config.wallet_buffer_blocks,
                max_txs_per_proof: config.wallet_max_txs_per_proof,
                tx_working_window_size: config.wallet_tx_working_window_size,
            }))
            .await?;
    }

    if args.auto_provers {
        handler
            .build_module::<AutoProver<SmtTokenProvableState>>(Arc::new(AutoProverCtx {
                data_directory: config.data_directory.clone(),
                prover: Arc::new(Risc0Prover::new(
                    hyle_smt_token::client::tx_executor_handler::metadata::SMT_TOKEN_ELF,
                )),
                contract_name: "oranj".into(),
                node: app_ctx.node_client.clone(),
                default_state: Default::default(),
                buffer_blocks: config.smt_buffer_blocks,
                max_txs_per_proof: config.smt_max_txs_per_proof,
                tx_working_window_size: config.smt_tx_working_window_size,
            }))
            .await?;
        handler
            .build_module::<AutoProver<SmtTokenProvableState>>(Arc::new(AutoProverCtx {
                data_directory: config.data_directory.clone(),
                prover: Arc::new(Risc0Prover::new(
                    hyle_smt_token::client::tx_executor_handler::metadata::SMT_TOKEN_ELF,
                )),
                contract_name: "vitamin".into(),
                node: app_ctx.node_client.clone(),
                default_state: Default::default(),
                buffer_blocks: config.smt_buffer_blocks,
                max_txs_per_proof: config.smt_max_txs_per_proof,
                tx_working_window_size: config.smt_tx_working_window_size,
            }))
            .await?;
        handler
            .build_module::<AutoProver<SmtTokenProvableState>>(Arc::new(AutoProverCtx {
                data_directory: config.data_directory.clone(),
                prover: Arc::new(Risc0Prover::new(
                    hyle_smt_token::client::tx_executor_handler::metadata::SMT_TOKEN_ELF,
                )),
                contract_name: "oxygen".into(),
                node: app_ctx.node_client.clone(),
                default_state: Default::default(),
                buffer_blocks: config.smt_buffer_blocks,
                max_txs_per_proof: config.smt_max_txs_per_proof,
                tx_working_window_size: config.smt_tx_working_window_size,
            }))
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
