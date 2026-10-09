use anyhow::Result;
use clap::Args;
use solana_client::rpc_client::RpcClient;
use solana_commitment_config::CommitmentConfig;
use solana_sdk::signature::{read_keypair_file, Keypair};

#[derive(Args, Clone)]
pub struct Config {
    #[arg(long, env = "RPC_URL", default_value = "http://127.0.0.1:8899", global = true)]
    pub rpc: String,
    /// Keeper keypair file. Gitignored; never commit it.
    #[arg(long, env = "KEEPER_KEYPAIR", default_value = "keeper/keeper-keypair.json", global = true)]
    pub keypair: String,
    /// Tracked-plan state (needed to burn nonces after a plan is closed, REQ14).
    #[arg(long, env = "KEEPER_STATE", default_value = "keeper/keeper-state.json", global = true)]
    pub state: String,
    /// REQ26: seconds past the deadline (on the finalized Clock) before the keeper will sign.
    #[arg(long, env = "KEEPER_SAFETY_MARGIN", default_value_t = 300, global = true)]
    pub safety_margin: i64,
    /// Refuse to run unless the RPC's genesis hash matches. Solana's chain identity is its genesis
    /// hash; set this per environment so a keeper can never be pointed at the wrong cluster.
    #[arg(long, env = "KEEPER_EXPECTED_GENESIS_HASH", global = true)]
    pub expected_genesis_hash: Option<String>,
}

impl Config {
    pub fn keypair_path(&self) -> String {
        self.keypair.clone()
    }

    pub fn load_keypair(&self) -> Result<Keypair> {
        read_keypair_file(&self.keypair)
            .map_err(|e| anyhow::anyhow!("cannot read keeper keypair {}: {e} (run `keygen`)", self.keypair))
    }

    pub fn rpc(&self) -> RpcClient {
        RpcClient::new_with_commitment(self.rpc.clone(), CommitmentConfig::confirmed())
    }
}
