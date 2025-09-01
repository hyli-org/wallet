use anyhow::{bail, Result};
use client_sdk::rest_client::NodeApiClient;
use sdk::{api::APIRegisterContract, info, ContractName, ProgramId, StateCommitment};
use std::{sync::Arc, time::Duration};
use tokio::time::timeout;

pub(crate) struct ContractInit {
    pub name: ContractName,
    pub program_id: [u8; 32],
    pub initial_state: StateCommitment,
    pub constructor_metadata: Vec<u8>,
}

pub(crate) async fn init_node(
    node: Arc<dyn NodeApiClient>,
    contracts: Vec<ContractInit>,
) -> Result<()> {
    for contract in contracts {
        init_contract(node.as_ref(), contract).await?;
    }
    Ok(())
}

async fn init_contract(node: &dyn NodeApiClient, contract: ContractInit) -> Result<()> {
    match node.get_contract(contract.name.clone()).await {
        Ok(existing) => {
            let onchain_program_id = existing.program_id.0;
            let program_id = contract.program_id;
            if onchain_program_id != program_id {
                bail!(
                    "Invalid program_id for {}. On-chain version is {}, expected {}",
                    contract.name,
                    hex::encode(onchain_program_id),
                    hex::encode(program_id)
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
                constructor_metadata: Some(contract.constructor_metadata),
                ..Default::default()
            })
            .await?;
            wait_contract_state(node, &contract.name).await?;
        }
    }
    Ok(())
}
async fn wait_contract_state(
    node: &dyn NodeApiClient,
    contract_name: &ContractName,
) -> anyhow::Result<()> {
    timeout(Duration::from_secs(30), async {
        loop {
            let resp = node.get_contract(contract_name.clone()).await;
            if resp.is_err() {
                info!("⏰ Waiting for contract {contract_name} state to be ready");
                tokio::time::sleep(Duration::from_millis(500)).await;
            } else {
                return Ok(());
            }
        }
    })
    .await?
}
