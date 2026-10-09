//! Plans the keeper has seen. When a tracked plan disappears on-chain (close_plan),
//! the keeper uses this record to find the nonce account and owner (REQ14).

use std::{collections::BTreeMap, fs, path::Path};

use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct Tracked {
    pub owner: String,
    pub nonce: String,
}

#[derive(Serialize, Deserialize, Default)]
pub struct State {
    /// plan PDA -> tracked info
    pub plans: BTreeMap<String, Tracked>,
}

impl State {
    pub fn load(path: &str) -> Result<Self> {
        if !Path::new(path).exists() {
            return Ok(Self::default());
        }
        Ok(serde_json::from_slice(&fs::read(path)?)?)
    }

    pub fn save(&self, path: &str) -> Result<()> {
        fs::write(path, serde_json::to_vec_pretty(self)?)?;
        Ok(())
    }
}
