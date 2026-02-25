use anyhow::Result;
use client_sdk::{helpers::risc0::Risc0Prover, rest_client::NodeApiClient};
use hyli_modules::modules::prover::{AutoProver, AutoProverCtx};
use hyli_modules::modules::{BuildApiContextInner, ModulesHandler};
use hyli_smt_token::client::tx_executor_handler::SmtTokenProvableState;
use sdk::ContractName;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use wallet::client::tx_executor_handler::Wallet;

pub(crate) struct AutoProversConfig {
    pub wallet_cn: ContractName,
    pub wallet_auto_prove: bool,
    pub smt_auto_prove: bool,
    pub data_directory: PathBuf,
    pub smt_max_txs_per_proof: usize,
    pub smt_tx_working_window_size: usize,
    pub wallet_max_txs_per_proof: usize,
    pub wallet_tx_working_window_size: usize,
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

    let idle_flush_interval = Duration::from_secs(config.idle_flush_interval_secs);

    if config.wallet_auto_prove {
        handler
            .build_module::<AutoProver<Wallet, Risc0Prover>>(Arc::new(AutoProverCtx {
                data_directory: config.data_directory.clone(),
                prover: Arc::new(Risc0Prover::new(
                    contracts::WALLET_ELF.to_vec(),
                    contracts::WALLET_ID,
                )),
                contract_name: config.wallet_cn.clone(),
                node: node_client.clone(),
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
