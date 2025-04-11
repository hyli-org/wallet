use clap::{Parser, Subcommand};
use contract2::client::tx_executor_handler::metadata::PROGRAM_ID;
use contract2::Contract2;
use contract2::Contract2Action;
use sdk::api::APIRegisterContract;
use sdk::{BlobTransaction, ZkContract};

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
#[command(propagate_version = true)]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    #[clap(long, short)]
    reproducible: bool,

    #[arg(long, default_value = "http://localhost:4321")]
    pub host: String,

    #[arg(long, default_value = "contract2")]
    pub contract_name: String,

    #[arg(long, default_value = "bob.contract2")]
    pub id: String,
}

#[derive(Subcommand)]
enum Commands {
    Register {},
    Increment,
}

#[tokio::main]
async fn main() {
    // Initialize tracing. In order to view logs, run `RUST_LOG=info cargo run`
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::filter::EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();

    let client = client_sdk::rest_client::NodeApiHttpClient::new(cli.host).unwrap();

    let contract_name = &cli.contract_name;

    // let prover = Risc0Prover::new(BLACKJACK_ELF);

    match cli.command {
        Commands::Register {} => {
            // Build initial state of contract
            let initial_state: Contract2 = Contract2::default();
            println!("Initial state: {:?}", initial_state);

            // Send the transaction to register the contract
            let res = client
                .register_contract(&APIRegisterContract {
                    verifier: "risc0-1".into(),
                    program_id: sdk::ProgramId(PROGRAM_ID.to_vec()),
                    state_commitment: initial_state.commit(),
                    contract_name: contract_name.clone().into(),
                })
                .await
                .unwrap();
            println!("✅ Register contract tx sent. Tx hash: {}", res);
        }
        Commands::Increment => {
            // ----
            // Build the blob transaction
            // ----
            let action = Contract2Action::Increment;
            let blobs = vec![sdk::Blob {
                contract_name: contract_name.clone().into(),
                data: sdk::BlobData(borsh::to_vec(&action).expect("failed to encode BlobData")),
            }];
            let blob_tx = BlobTransaction::new(cli.id.clone(), blobs.clone());

            // Send the blob transaction
            let blob_tx_hash = client.send_tx_blob(&blob_tx).await.unwrap();
            println!("✅ Blob tx sent. Tx hash: {}", blob_tx_hash);
        }
    }
}
