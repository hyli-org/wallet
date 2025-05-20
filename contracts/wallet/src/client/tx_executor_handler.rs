use anyhow::Context;
use client_sdk::transaction_builder::TxExecutorHandler;
use sdk::{utils::as_hyle_output, Blob, Calldata, RegisterContractEffect, ZkContract};

use crate::Wallet;

impl TxExecutorHandler for Wallet {
    fn build_commitment_metadata(&self, _blob: &Blob) -> anyhow::Result<Vec<u8>> {
        borsh::to_vec(self).context("Failed to serialize Wallet")
    }

    fn handle(&mut self, calldata: &Calldata) -> anyhow::Result<sdk::HyleOutput> {
        let initial_state_commitment = <Self as ZkContract>::commit(self);
        let mut res = <Self as ZkContract>::execute(self, calldata);
        let next_state_commitment = <Self as ZkContract>::commit(self);
        Ok(as_hyle_output(
            initial_state_commitment,
            next_state_commitment,
            calldata,
            &mut res,
        ))
    }

    fn construct_state(
        _register_blob: &RegisterContractEffect,
        _metadata: &Option<Vec<u8>>,
    ) -> anyhow::Result<Self> {
        Ok(Self::default())
    }
}
