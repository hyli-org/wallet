use anyhow::{bail, Result};
use client_sdk::rest_client::{IndexerApiHttpClient, NodeApiClient, NodeApiHttpClient};
use sdk::{api::APIRegisterContract, info, ContractName, ProgramId, StateCommitment};
use std::{sync::Arc, time::Duration};
use tokio::time::timeout;

pub struct ContractInit {
    pub name: ContractName,
    pub program_id: [u8; 32],
    pub initial_state: StateCommitment,
}

pub async fn init_node(
    node: Arc<NodeApiHttpClient>,
    indexer: Arc<IndexerApiHttpClient>,
    contracts: Vec<ContractInit>,
) -> Result<()> {
    for contract in contracts {
        init_contract(&node, &indexer, contract).await?;
    }
    Ok(())
}

async fn init_contract(
    node: &NodeApiHttpClient,
    indexer: &IndexerApiHttpClient,
    contract: ContractInit,
) -> Result<()> {
    match indexer.get_indexer_contract(&contract.name).await {
        Ok(existing) => {
            let onchain_program_id = hex::encode(existing.program_id.as_slice());
            let program_id = hex::encode(contract.program_id);
            if onchain_program_id != program_id {
                bail!(
                    "Invalid program_id for {}. On-chain version is {}, expected {}",
                    contract.name,
                    onchain_program_id,
                    program_id
                );
            }
            info!("✅ {} contract is up to date", contract.name);
        }
        Err(_) => {
            info!("🚀 Registering {} contract", contract.name);
            node.register_contract(APIRegisterContract {
                verifier: "risc0-1".into(),
                program_id: ProgramId(contract.program_id.to_vec()),
                state_commitment: contract.initial_state,
                contract_name: contract.name.clone(),
                ..Default::default()
            })
            .await?;
            wait_contract_state(indexer, &contract.name).await?;
        }
    }
    Ok(())
}
async fn wait_contract_state(
    indexer: &IndexerApiHttpClient,
    contract: &ContractName,
) -> anyhow::Result<()> {
    timeout(Duration::from_secs(30), async {
        loop {
            let resp = indexer.get_indexer_contract(contract).await;
            if resp.is_err() {
                info!("⏰ Waiting for contract {contract} state to be ready");
                tokio::time::sleep(Duration::from_millis(500)).await;
            } else {
                return Ok(());
            }
        }
    })
    .await?
}
