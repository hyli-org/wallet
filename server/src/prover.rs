use std::{collections::BTreeMap, sync::Arc};

use crate::app::{AppEvent, AppModuleCtx};
use anyhow::{anyhow, Result};
use client_sdk::{contract_indexer::ContractStateStore, helpers::risc0::Risc0Prover};
use hyle::{
    bus::BusClientSender,
    log_error, module_handle_messages,
    node_state::module::NodeStateEvent,
    utils::modules::{module_bus_client, Module},
};
use sdk::{
    BlobIndex, BlobTransaction, Block, BlockHeight, Calldata, Hashed, ProofTransaction,
    TransactionData, TxHash, ZkContract, HYLE_TESTNET_CHAIN_ID,
};
use tracing::{debug, error, info};
use wallet::Wallet;

pub struct ProverModule {
    bus: ProverModuleBusClient,
    ctx: Arc<ProverModuleCtx>,
    unsettled_txs: Vec<(BlobTransaction, sdk::TxContext)>,
    state_history: Vec<(TxHash, Wallet)>,
    wallet: Wallet,
}

module_bus_client! {
#[derive(Debug)]
pub struct ProverModuleBusClient {
    sender(AppEvent),
    receiver(NodeStateEvent),
}
}
pub struct ProverModuleCtx {
    pub app: Arc<AppModuleCtx>,
    pub start_height: BlockHeight,
}

impl Module for ProverModule {
    type Context = Arc<ProverModuleCtx>;

    async fn build(ctx: Self::Context) -> Result<Self> {
        let bus = ProverModuleBusClient::new_from_bus(ctx.app.common.bus.new_handle()).await;

        let file = ctx
            .app
            .common
            .config
            .data_directory
            .join(format!("state_indexer_{}.bin", ctx.app.wallet_cn).as_str());

        let store = Self::load_from_disk_or_default::<ContractStateStore<Wallet>>(file.as_path());

        let wallet = store.state.unwrap_or_default();

        Ok(ProverModule {
            bus,
            wallet,
            ctx,
            unsettled_txs: vec![],
            state_history: vec![],
        })
    }

    async fn run(&mut self) -> Result<()> {
        module_handle_messages! {
            on_bus self.bus,
            listen<NodeStateEvent> event => {
                _ = log_error!(self.handle_node_state_event(event).await, "handle note state event")
            }

        };

        Ok(())
    }
}

impl ProverModule {
    async fn handle_node_state_event(&mut self, event: NodeStateEvent) -> Result<()> {
        let NodeStateEvent::NewBlock(block) = event;
        self.handle_processed_block(*block).await?;

        Ok(())
    }

    async fn handle_processed_block(&mut self, block: Block) -> Result<()> {
        for (_, tx) in block.txs {
            if let TransactionData::Blob(tx) = tx.transaction_data {
                let tx_ctx = sdk::TxContext {
                    block_height: block.block_height,
                    block_hash: block.hash.clone(),
                    timestamp: block.block_timestamp.clone(),
                    lane_id: block.lane_ids.get(&tx.hashed()).unwrap().clone(),
                    chain_id: HYLE_TESTNET_CHAIN_ID,
                };

                self.handle_blob(tx, tx_ctx);
            }
        }

        for tx in block.successful_txs {
            self.settle_tx_success(tx)?;
        }

        for tx in block.timed_out_txs {
            self.settle_tx_failed(tx)?;
        }

        for tx in block.failed_txs {
            self.settle_tx_failed(tx)?;
        }

        Ok(())
    }

    fn handle_blob(&mut self, tx: BlobTransaction, tx_ctx: sdk::TxContext) {
        for (index, blob) in tx.blobs.iter().enumerate() {
            if blob.contract_name == self.ctx.app.wallet_cn {
                self.prove_wallet_blob(&index.into(), &tx, &tx_ctx);
            }
        }
        self.unsettled_txs.push((tx, tx_ctx));
    }

    fn settle_tx_success(&mut self, tx: TxHash) -> Result<()> {
        let pos = self.state_history.iter().position(|(h, _)| h == &tx);
        if let Some(pos) = pos {
            self.state_history = self.state_history.split_off(pos);
        }
        self.settle_tx(tx)?;
        Ok(())
    }

    fn settle_tx_failed(&mut self, tx: TxHash) -> Result<()> {
        self.handle_all_next_blobs(tx.clone())?;
        self.state_history.retain(|(h, _)| h != &tx);
        self.settle_tx(tx)
    }

    fn settle_tx(&mut self, tx: TxHash) -> Result<()> {
        let tx = self
            .unsettled_txs
            .iter()
            .position(|(t, _)| t.hashed() == tx);
        if let Some(pos) = tx {
            self.unsettled_txs.remove(pos);
        }
        Ok(())
    }

    fn handle_all_next_blobs(&mut self, failed_tx: TxHash) -> Result<()> {
        let idx = self
            .unsettled_txs
            .iter()
            .position(|(t, _)| t.hashed() == failed_tx);
        let prev_state = self
            .state_history
            .iter()
            .enumerate()
            .find(|(_, (h, _))| h == &failed_tx)
            .and_then(|(i, _)| {
                if i > 0 {
                    self.state_history.get(i - 1)
                } else {
                    None
                }
            });
        if let Some((_, wallet)) = prev_state {
            debug!("Reverting to previous state: {:?}", wallet);
            self.wallet = wallet.clone();
        } else {
            self.wallet = Wallet::default();
        }
        for (tx, ctx) in self.unsettled_txs.clone().iter().skip(idx.unwrap_or(0) + 1) {
            for (index, blob) in tx.blobs.iter().enumerate() {
                if blob.contract_name == self.ctx.app.wallet_cn {
                    debug!(
                        "Re-execute blob for tx {} after a previous tx failure",
                        tx.hashed()
                    );
                    self.state_history.retain(|(h, _)| h != &tx.hashed());
                    self.prove_wallet_blob(&index.into(), tx, ctx);
                }
            }
        }

        Ok(())
    }

    fn prove_wallet_blob(
        &mut self,
        blob_index: &BlobIndex,
        tx: &BlobTransaction,
        tx_ctx: &sdk::TxContext,
    ) {
        let old_tx = tx_ctx.block_height.0 < self.ctx.start_height.0;

        let blob = tx.blobs.get(blob_index.0).unwrap();
        let blobs = tx.blobs.clone();
        let tx_hash = tx.hashed();

        let prover = Risc0Prover::new(contracts::WALLET_ELF);

        let Ok(state) = self.wallet.as_bytes() else {
            error!("Failed to serialize state on tx: {}", tx_hash);
            return;
        };

        let commitment_metadata = state;

        let calldata = Calldata {
            identity: tx.identity.clone(),
            tx_hash: tx_hash.clone(),
            private_input: vec![],
            blobs: blobs.clone().into(),
            index: *blob_index,
            tx_ctx: Some(tx_ctx.clone()),
            tx_blob_count: blobs.len(),
        };

        debug!("{} State before tx: {:?}", tx.hashed(), self.wallet);
        match self.wallet.execute(&calldata).map_err(|e| anyhow!(e)) {
            Err(e) => {
                info!("{} Error while executing contract: {e}", tx.hashed());
                if !old_tx {
                    self.bus
                        .send(AppEvent::FailedTx(tx_hash.clone(), e.to_string()))
                        .unwrap();
                }
            }
            Ok(msg) => {
                debug!("{} Executed contract: {:?}", tx.hashed(), msg.0);
            }
        }
        debug!("{} State after tx: {:?}", tx.hashed(), self.wallet);

        self.state_history
            .push((tx_hash.clone(), self.wallet.clone()));

        if old_tx {
            return;
        }

        self.bus
            .send(AppEvent::SequencedTx(tx_hash.clone()))
            .unwrap();
        info!("Proving tx: {}. Blob for {}", tx_hash, blob.contract_name);

        let node_client = self.ctx.app.node_client.clone();
        let blob = blob.clone();
        tokio::task::spawn(async move {
            match prover.prove(commitment_metadata, calldata).await {
                Ok(proof) => {
                    info!("Proof generated for tx: {}", tx_hash);
                    let tx = ProofTransaction {
                        contract_name: blob.contract_name.clone(),
                        proof,
                    };
                    let _ = log_error!(
                        node_client.send_tx_proof(&tx).await,
                        "failed to send proof to node"
                    );
                }
                Err(e) => {
                    error!("Error proving tx: {:?}", e);
                }
            };
        });
    }
}
