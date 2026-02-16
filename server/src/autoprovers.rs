use anyhow::Result;
use client_sdk::{helpers::risc0::Risc0Prover, rest_client::NodeApiClient};
use hyli_modules::modules::contract_listener::{ContractListener, ContractListenerConf};
use hyli_modules::modules::prover::{AutoProver, AutoProverCtx};
use hyli_modules::modules::{BuildApiContextInner, ModulesHandler};
use hyli_smt_token::client::tx_executor_handler::SmtTokenProvableState;
use sdk::ContractName;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use wallet::client::tx_executor_handler::Wallet;

use server::new_wallet;

pub(crate) struct AutoProversConfig {
    pub wallet_cn: ContractName,
    pub wallet_auto_prove: bool,
    pub smt_auto_prove: bool,
    pub data_directory: PathBuf,
    pub indexer_database_url: String,
    pub smt_max_txs_per_proof: usize,
    pub smt_tx_working_window_size: usize,
    pub wallet_max_txs_per_proof: usize,
    pub wallet_tx_working_window_size: usize,
    pub listener_poll_interval_secs: u64,
    pub idle_flush_interval_secs: u64,
    pub tx_buffer_size: usize,
}

pub(crate) async fn setup_autoprovers_modules(
    config: &AutoProversConfig,
    handler: &mut ModulesHandler,
    api_ctx: Arc<BuildApiContextInner>,
    node_client: Arc<dyn NodeApiClient + Send + Sync>,
) -> Result<()> {
    let oranj_cn: ContractName = "oranj".into();
    let vitamin_cn: ContractName = "vitamin".into();
    let oxygen_cn: ContractName = "oxygen".into();

    let mut listener_contracts = HashSet::new();
    if config.wallet_auto_prove {
        listener_contracts.insert(config.wallet_cn.clone());
    }
    if config.smt_auto_prove {
        listener_contracts.insert(oranj_cn.clone());
        listener_contracts.insert(vitamin_cn.clone());
        listener_contracts.insert(oxygen_cn.clone());
    }

    if !listener_contracts.is_empty() {
        handler
            .build_module::<ContractListener>(ContractListenerConf {
                database_url: config.indexer_database_url.clone(),
                data_directory: config.data_directory.clone(),
                contracts: listener_contracts,
                poll_interval: Duration::from_secs(config.listener_poll_interval_secs),
                replay_settled_from_start: true,
            })
            .await?;
    }

    let idle_flush_interval = Duration::from_secs(config.idle_flush_interval_secs);

    if config.wallet_auto_prove {
        let (_, wallet) = new_wallet(&config.wallet_cn);

        handler
            .build_module::<AutoProver<Wallet, Risc0Prover>>(Arc::new(AutoProverCtx {
                data_directory: config.data_directory.clone(),
                prover: Arc::new(Risc0Prover::new(
                    contracts::WALLET_ELF.to_vec(),
                    contracts::WALLET_ID,
                )),
                contract_name: config.wallet_cn.clone(),
                node: node_client.clone(),
                default_state: wallet,
                api: Some(api_ctx.clone()),
                max_txs_per_proof: config.wallet_max_txs_per_proof,
                tx_working_window_size: config.wallet_tx_working_window_size,
                idle_flush_interval,
                tx_buffer_size: config.tx_buffer_size,
            }))
            .await?;
    }

    if config.smt_auto_prove {
        for contract_name in [oranj_cn, vitamin_cn, oxygen_cn] {
            handler
                .build_module::<AutoProver<SmtTokenProvableState, Risc0Prover>>(Arc::new(
                    AutoProverCtx {
                        data_directory: config.data_directory.clone(),
                        prover: Arc::new(Risc0Prover::new(
                            hyli_smt_token::client::tx_executor_handler::metadata::SMT_TOKEN_ELF
                                .to_vec(),
                            hyli_smt_token::client::tx_executor_handler::metadata::PROGRAM_ID,
                        )),
                        contract_name,
                        node: node_client.clone(),
                        default_state: Default::default(),
                        max_txs_per_proof: config.smt_max_txs_per_proof,
                        tx_working_window_size: config.smt_tx_working_window_size,
                        api: None,
                        idle_flush_interval,
                        tx_buffer_size: config.tx_buffer_size,
                    },
                ))
                .await?;
        }
    }

    Ok(())
}
