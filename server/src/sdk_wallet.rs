use crate::app::WalletModule;
use crate::app::WalletModuleCtx;
use crate::init::init_node;
use crate::init::ContractInit;
use crate::new_wallet;
use client_sdk::helpers::risc0::Risc0Prover;
use client_sdk::transaction_builder::TxExecutorHandler;

use client_sdk::rest_client::NodeApiClient;
use hyli_modules::modules::contract_state_indexer::{
    ContractStateIndexer, ContractStateIndexerCtx,
};
use hyli_modules::modules::prover::AutoProver;
use hyli_modules::modules::prover::AutoProverCtx;
use hyli_modules::modules::BuildApiContextInner;
use hyli_modules::modules::ModulesHandler;
use sdk::ContractName;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{error, info};
use wallet::client::indexer::WalletEvent;
use wallet::client::tx_executor_handler::Wallet;

pub(crate) struct SdkWalletConfig {
    pub wallet_cn: ContractName,
    pub data_directory: PathBuf,
    pub noinit: bool,
    pub auto_prove: bool,
    pub wallet_buffer_blocks: u32,
    pub wallet_max_txs_per_proof: usize,
    pub wallet_tx_working_window_size: usize,
}

pub(crate) async fn setup_wallet_modules(
    config: &SdkWalletConfig,
    handler: &mut ModulesHandler,
    api_ctx: Arc<BuildApiContextInner>,
    node_client: Arc<dyn NodeApiClient + Send + Sync>,
) -> anyhow::Result<()> {
    let (wallet_constructor, wallet) = new_wallet();
    let contracts = vec![ContractInit {
        name: config.wallet_cn.clone(),
        program_id: contracts::WALLET_ID,
        initial_state: wallet.get_state_commitment(),
        constructor_metadata: borsh::to_vec(&wallet_constructor).expect("must succeed"),
    }];

    if config.noinit {
        info!("Skipping initialization, using existing contracts");
    } else {
        match init_node(node_client.clone(), contracts).await {
            Ok(_) => {}
            Err(e) => {
                error!("Error initializing node: {:?}", e);
                return Ok(());
            }
        }
    }

    let app_ctx = Arc::new(WalletModuleCtx {
        api: api_ctx.clone(),
        node_client,
        wallet_cn: config.wallet_cn.clone(),
    });

    handler
        .build_module::<WalletModule>(app_ctx.clone())
        .await?;

    handler
        .build_module::<ContractStateIndexer<Wallet, WalletEvent>>(ContractStateIndexerCtx {
            contract_name: config.wallet_cn.clone(),
            data_directory: config.data_directory.clone(),
            api: api_ctx.clone(),
        })
        .await?;

    if config.auto_prove {
        // Wallet auto prover
        handler
            .build_module::<AutoProver<Wallet>>(Arc::new(AutoProverCtx {
                data_directory: config.data_directory.clone(),
                prover: Arc::new(Risc0Prover::new(
                    contracts::WALLET_ELF,
                    contracts::WALLET_ID,
                )),
                contract_name: config.wallet_cn.clone(),
                node: app_ctx.node_client.clone(),
                default_state: wallet.clone(),
                buffer_blocks: config.wallet_buffer_blocks,
                max_txs_per_proof: config.wallet_max_txs_per_proof,
                tx_working_window_size: config.wallet_tx_working_window_size,
                api: Some(api_ctx.clone()),
            }))
            .await?;
    }

    Ok(())
}
