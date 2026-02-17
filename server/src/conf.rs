use config::{Config, Environment, File};
use hyli_modules::modules::websocket::WebSocketConfig;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Conf {
    pub id: String,
    /// The log format to use - "json", "node" or "full" (default)
    pub log_format: String,
    /// Directory name to store node state.
    pub data_directory: PathBuf,
    /// When running only the indexer, the address of the DA server to connect to
    pub da_read_from: String,
    pub node_url: String,

    pub indexer_database_url: String,

    pub db_url: String,

    pub rest_server_port: u16,
    pub rest_server_max_body_size: usize,

    pub admin_server_port: u16,
    pub admin_server_max_body_size: usize,

    pub wallet_auto_prover: bool,
    pub wallet_max_txs_per_proof: usize,
    pub wallet_tx_working_window_size: usize,

    pub smt_auto_provers: bool,
    pub smt_max_txs_per_proof: usize,
    pub smt_tx_working_window_size: usize,

    pub auto_prover_listener_poll_interval_secs: u64,
    pub auto_prover_idle_flush_interval_secs: u64,
    pub auto_prover_tx_buffer_size: usize,

    /// Websocket configuration
    pub websocket: WebSocketConfig,
}

impl Conf {
    pub fn new(config_files: Vec<String>) -> Result<Self, anyhow::Error> {
        let mut s = Config::builder().add_source(File::from_str(
            include_str!("conf_defaults.toml"),
            config::FileFormat::Toml,
        ));
        // Priority order: config file, then environment variables
        for config_file in config_files {
            s = s.add_source(File::with_name(&config_file).required(false));
        }
        let conf: Self = s
            .add_source(
                Environment::with_prefix("hyli")
                    .separator("__")
                    .prefix_separator("_"),
            )
            .build()?
            .try_deserialize()?;
        Ok(conf)
    }
}
