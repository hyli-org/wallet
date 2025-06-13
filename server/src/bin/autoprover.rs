use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use clap::Parser;
use client_sdk::rest_client::{IndexerApiHttpClient, NodeApiHttpClient};
use hyle_modules::{
    bus::{metrics::BusMetrics, SharedMessageBus},
    modules::{
        da_listener::{DAListener, DAListenerConf},
        prover::{AutoProver, AutoProverCtx},
        rest::{RestApi, RestApiRunContext},
        BuildApiContextInner, ModulesHandler,
    },
    utils::logger::setup_tracing,
};
use prometheus::Registry;
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
    let _indexer_client = Arc::new(
        IndexerApiHttpClient::new(config.indexer_url.clone()).context("build indexer client")?,
    );

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
        router: Mutex::new(None),
        openapi: Default::default(),
    });

    // This module connects to the da_address and receives all the blocks
    handler
        .build_module::<DAListener>(DAListenerConf {
            start_block: None,
            data_directory: config.data_directory.clone(),
            da_read_from: config.da_read_from.clone(),
        })
        .await?;

    // Ajout de l'autoprover du wallet
    let wallet_cn: ContractName = "wallet".into();
    let wallet = new_wallet();
    handler
        .build_module::<AutoProver<Wallet>>(Arc::new(AutoProverCtx {
            data_directory: config.data_directory.clone(),
            prover: Arc::new(client_sdk::helpers::risc0::Risc0Prover::new(
                contracts::WALLET_ELF,
            )),
            contract_name: wallet_cn,
            node: node_client.clone(),
            default_state: wallet,
            buffer_blocks: config.wallet_buffer_blocks,
            max_txs_per_proof: config.wallet_max_txs_per_proof,
            tx_working_window_size: config.wallet_tx_working_window_size,
        }))
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

    #[cfg(unix)]
    {
        use tokio::signal::unix;
        let mut terminate = unix::signal(unix::SignalKind::interrupt())?;
        tokio::select! {
            Err(e) = handler.start_modules() => {
                tracing::error!("Error running modules: {:?}", e);
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
                tracing::error!("Error running modules: {:?}", e);
            }
            _ = tokio::signal::ctrl_c() => {
                info!("Ctrl-C received, shutting down");
            }
        }
        _ = handler.shutdown_modules().await;
    }

    Ok(())
}
