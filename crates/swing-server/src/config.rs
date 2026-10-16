//! Server configuration (spike).
//!
//! Provider is OpenAI-compatible Chat Completions, configured via env (D-41):
//! `OPENAI_BASE_URL` is required; `OPENAI_MODEL` and `OPENAI_API_KEY` are
//! optional (the request omits the `model` field / `Authorization` header when
//! they are unset).

use anyhow::{anyhow, bail, Result};

#[derive(Clone)]
pub struct Config {
    pub base_url: String,
    pub model: Option<String>,
    pub api_key: Option<String>,
    /// Path to the `swing-guest` binary the server spawns as a child. The server
    /// hands it one end of a `socketpair` as its control channel (revised D-27).
    pub guest_bin: String,
    /// Host work directory handed to the guest as the container workspace.
    pub work_dir: String,
    /// Opt-in sandbox in the container child (T4).
    pub sandbox: bool,
}

/// Unset or empty counts as absent.
fn optional_env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.is_empty())
}

impl Config {
    pub fn from_env() -> Result<Config> {
        // Required: never fall back to a default endpoint, so a missing base URL
        // cannot send someone's key to a provider they didn't choose.
        let base_url = match optional_env("OPENAI_BASE_URL") {
            Some(u) => u,
            None => bail!("OPENAI_BASE_URL is required (e.g. https://api.openai.com/v1)"),
        };
        let model = optional_env("OPENAI_MODEL");
        let api_key = optional_env("OPENAI_API_KEY");
        // The guest binary: SWING_GUEST_BIN, else a `swing-guest` sibling of this
        // binary (the cargo target dir). Verify it exists so a missing guest is a
        // clear error, not a spawn failure later.
        let guest_bin = match optional_env("SWING_GUEST_BIN") {
            Some(b) => b,
            None => {
                let exe = std::env::current_exe()?;
                let dir = exe.parent().ok_or_else(|| anyhow!("cannot locate binary dir"))?;
                dir.join("swing-guest").to_string_lossy().into_owned()
            }
        };
        if !std::path::Path::new(&guest_bin).exists() {
            bail!("swing-guest binary not found at {guest_bin} (set SWING_GUEST_BIN)");
        }

        let work_dir = match optional_env("SWING_WORK_DIR") {
            Some(d) => d,
            None => std::env::current_dir()?.to_string_lossy().into_owned(),
        };
        let sandbox = std::env::var("SWING_SANDBOX").map(|v| v == "1").unwrap_or(false);

        Ok(Config {
            base_url,
            model,
            api_key,
            guest_bin,
            work_dir,
            sandbox,
        })
    }
}
