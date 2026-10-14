//! Server configuration (spike).
//!
//! Provider is OpenAI-compatible Chat Completions, configured via env (D-41):
//! `OPENAI_BASE_URL` is required; `OPENAI_MODEL` and `OPENAI_API_KEY` are
//! optional (the request omits the `model` field / `Authorization` header when
//! they are unset).

use anyhow::{bail, Result};

#[derive(Clone)]
pub struct Config {
    pub base_url: String,
    pub model: Option<String>,
    pub api_key: Option<String>,
    /// Loopback address of `swing-guest` (D-27: loopback TCP everywhere).
    pub guest_addr: String,
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
        let guest_addr =
            std::env::var("SWING_GUEST_ADDR").unwrap_or_else(|_| "127.0.0.1:7700".into());

        Ok(Config {
            base_url,
            model,
            api_key,
            guest_addr,
        })
    }
}
