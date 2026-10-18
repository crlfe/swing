//! The message set (design §6 wire primitives).
//!
//! The JSON header carries one of these tagged messages (`"type": "..."`).
//! Binary payloads (file contents, command output) travel in the frame *body*,
//! never as escaped strings — see design §6 "Binary-safe".
//!
//! This enum is the Rust source of truth for `schema.toml`. Keep them in sync
//! (OQ-3 / T3).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Msg {
    // ---- handshake: guest -> server ----
    Hello { build_id: String },
    Ready,

    // ---- container lifecycle (stubs; not exercised in the spike) ----
    ContainerCreate { id: u32 },
    ContainerDestroy { id: u32 },
    ContainerReady { id: u32 },
    Shutdown,

    // ---- exec: server -> guest ----
    ExecStart {
        command: String,
        #[serde(default)]
        cwd: Option<String>,
        #[serde(default)]
        timeout_ms: Option<u64>,
    },
    ExecCancel,

    // ---- exec: guest -> server (chunk bytes travel in the frame body) ----
    ExecOutput {
        #[serde(default)]
        stderr: bool,
    },
    ExecExit {
        #[serde(default)]
        code: Option<i32>,
        #[serde(default)]
        signal: Option<i32>,
        /// True when the guest killed the process for exceeding `timeout_ms`.
/// Keeps timeout distinct from a genuine signal death (design §6).
        #[serde(default)]
        timed_out: bool,
        runtime_ms: u64,
    },

    // ---- fs: server -> guest ----
    FsRead {
        path: String,
        #[serde(default)]
        offset: Option<u64>,
        #[serde(default)]
        limit: Option<u64>,
    },
    // Content bytes travel in the frame body.
    FsWrite { path: String },
    FsList { path: String },

    // ---- fs: guest -> server (read bytes travel in the frame body) ----
    FsResult {
        ok: bool,
        /// Model-actionable code: `no_such_file`, `bad_path`, `payload_too_large`,
/// ... never a raw errno (design §6 / T1).
        #[serde(default)]
        error: Option<String>,
        #[serde(default)]
        entries: Vec<FsEntry>,
        #[serde(default)]
        total: Option<u64>,
        #[serde(default)]
        truncated: bool,
    },

    // ---- generic ----
    Error { code: String, message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FsEntry {
    pub name: String,
    pub kind: EntryKind,
    pub size: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    File,
    Dir,
    Other,
}
