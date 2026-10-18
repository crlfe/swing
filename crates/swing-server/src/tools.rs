//! Model-facing tool surface (design §6, T1).
//!
//! Two layers, kept distinct (design §6): the JSON schema the model sees,
//! and the wire primitives sent to `swing-guest`. `dispatch` is the seam.
//!
//! The four v1 tools (D-43): read_file, write_file, list_dir, shell.
//! Results are formatted as model-actionable text: explicit truncation markers,
//! error codes the model can act on — not raw errno.
//!
//! Tool error recovery (T1): every *tool-level* failure — a guest rejection
//! (`bad_path`, `no_such_file`, `payload_too_large`, ...), a malformed/missing
//! argument, or an unknown tool — is returned to the model as actionable text and
//! recorded in the transcript, so the model can see it and correct course. Only a
//! `GuestError::Transport` (the channel or guest died) propagates as `Err`, which
//! ends the attempt.

use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use crate::guest::{ExecResult, FsListResult, FsReadResult, GuestClient, GuestError};
use swing_proto::EntryKind;

/// Provisional default wall-clock timeout for `shell` when the model omits
/// `timeout`, so a runaway command cannot hang the single-threaded server
/// forever (cgroups are not wired yet). `timeout: 0` opts out. Revisit at T3.
const DEFAULT_SHELL_TIMEOUT_MS: u64 = 60_000;

/// OpenAI function-tool specs (D-41: provider tool-schema feature).
pub fn tool_specs() -> Vec<Value> {
    vec![
        json!({
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read a text file under /work. Output may be truncated; a trailing '[truncated: ...]' marker reports how many bytes were shown and the offset to re-read from.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Path relative to /work." },
                        "offset": { "type": "integer", "description": "Byte offset to start reading from." },
                        "limit": { "type": "integer", "description": "Max bytes to return." }
                    },
                    "required": ["path"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "write_file",
                "description": "Create or overwrite a text file under /work.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Path relative to /work." },
                        "content": { "type": "string", "description": "Full file contents." }
                    },
                    "required": ["path", "content"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "list_dir",
                "description": "List a directory under /work. Returns entries with type and size. A trailing '[truncated: ...]' marker means the directory has more entries than were returned.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Directory relative to /work (use '.' for the root)." }
                    },
                    "required": ["path"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "shell",
                "description": "Run a shell command via `sh -c` in the workspace. Returns stdout, stderr, and the exit status. A '[timeout]' marker means the command was killed for exceeding the timeout.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string", "description": "Shell command string." },
                        "cwd": { "type": "string", "description": "Working directory relative to /work." },
                        "timeout": { "type": "integer", "description": "Timeout in seconds; the command is killed if it runs longer. Defaults to 60s; 0 means no timeout." }
                    },
                    "required": ["command"]
                }
            }
        }),
    ]
}

/// Execute one tool call and return the text handed back to the model.
///
/// Returns `Err` only for a transport/guest-death failure (the attempt must end).
/// Every tool-level failure is an `Ok` carrying model-actionable text.
pub fn dispatch(name: &str, args: &Value, guest: &mut GuestClient) -> Result<String> {
    match name {
        "shell" => {
            let command = match arg_str(args, "command") {
                Ok(s) => s,
                Err(e) => return Ok(tool_error(e)),
            };
            let cwd = match args.get("cwd") {
                None | Some(Value::Null) => None,
                Some(v) => match v.as_str() {
                    Some(s) => Some(s),
                    None => return Ok(tool_error("shell: 'cwd' must be a string")),
                },
            };
            // `timeout` is in seconds on the model-facing schema; the wire takes
            // milliseconds. Absent -> a safe default; 0 -> explicitly no timeout.
            let timeout_ms = match args.get("timeout") {
                None | Some(Value::Null) => Some(DEFAULT_SHELL_TIMEOUT_MS),
                Some(v) => match v.as_u64() {
                    Some(0) => None,
                    Some(secs) => Some(secs.saturating_mul(1000)),
                    None => {
                        return Ok(tool_error(
                            "shell: 'timeout' must be a non-negative integer (seconds)",
                        ))
                    }
                },
            };
            let r = guest
                .exec(command, cwd, timeout_ms)
                .map(|r| format_exec(&r));
            fold(r)
        }

        "read_file" => {
            let path = match arg_str(args, "path") {
                Ok(s) => s,
                Err(e) => return Ok(tool_error(e)),
            };
            let offset = opt_u64(args, "offset");
            let limit = opt_u64(args, "limit");
            let start = offset.unwrap_or(0);
            let r = guest.fs_read(path, offset, limit).map(|r| format_read(&r, start));
            fold(r)
        }

        "write_file" => {
            let path = match arg_str(args, "path") {
                Ok(s) => s,
                Err(e) => return Ok(tool_error(e)),
            };
            let content = match args.get("content").and_then(|c| c.as_str()) {
                Some(c) => c,
                None => return Ok(tool_error("write_file: missing 'content'")),
            };
            let r = guest
                .fs_write(path, content.as_bytes())
                .map(|_| format!("wrote {} bytes to {path}", content.len()));
            fold(r)
        }

        "list_dir" => {
            let path = match arg_str(args, "path") {
                Ok(s) => s,
                Err(e) => return Ok(tool_error(e)),
            };
            let r = guest.fs_list(path).map(|res| format_list(&res));
            fold(r)
        }

        other => Ok(tool_error(format!("unknown tool: {other}"))),
    }
}

/// Fold a guest call result into model-facing text: a rejection becomes an
/// `[error: ...]` string (attempt continues); a transport failure propagates as
/// `Err` (attempt ends).
fn fold(result: Result<String, GuestError>) -> Result<String> {
    match result {
        Ok(text) => Ok(text),
        Err(GuestError::Rejected(code)) => Ok(tool_error(code)),
        Err(GuestError::Transport(e)) => Err(e),
    }
}

fn tool_error(msg: impl std::fmt::Display) -> String {
    format!("[error: {msg}]")
}

/// Render a read result. On truncation, the marker tells the model exactly how
/// many bytes were shown and the offset to continue from (OQ-1 truncation).
fn format_read(r: &FsReadResult, start: u64) -> String {
    let mut text = String::from_utf8_lossy(&r.bytes).into_owned();
    if r.truncated {
        let shown = start + r.bytes.len() as u64;
        let total = r.total.unwrap_or(shown);
        text.push_str(&format!(
            "\n[truncated: showing {start}..{shown} of {total} bytes; re-read with offset {shown}]"
        ));
    }
    text
}

fn format_exec(r: &ExecResult) -> String {
    let mut out = String::new();
    out.push_str(&r.stdout);
    if !r.stderr.is_empty() {
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str("[stderr]\n");
        out.push_str(&r.stderr);
    }
    // Timeout is distinct from a genuine signal death (design §6).
    if r.timed_out {
        out.push_str("\n[timeout]");
    } else {
        match (r.code, r.signal) {
            (Some(0), _) => {}
            (Some(c), _) => out.push_str(&format!("\n[exit {c}]")),
            (None, Some(sig)) => out.push_str(&format!("\n[signal {sig}]")),
            (None, None) => out.push_str("\n[unknown exit status]"),
        }
    }
    out
}

fn format_list(res: &FsListResult) -> String {
    if res.entries.is_empty() {
        return "(empty)".to_string();
    }
    let mut out = String::new();
    for e in &res.entries {
        let kind = match e.kind {
            EntryKind::File => "file",
            EntryKind::Dir => "dir",
            EntryKind::Other => "other",
        };
        out.push_str(&format!("{kind}\t{}\t{}\n", e.size, e.name));
    }
    if res.truncated {
        out.push_str(&format!(
            "[truncated: showing {} of {} entries]",
            res.entries.len(),
            res.total.unwrap_or(0)
        ));
    }
    out
}

fn arg_str<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    args.get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("missing string argument '{key}'"))
}

/// Optional non-negative integer argument; absent or non-integer is `None`.
fn opt_u64(args: &Value, key: &str) -> Option<u64> {
    args.get(key).and_then(|v| v.as_u64())
}

#[cfg(test)]
mod tests {
    use super::*;
    use swing_proto::FsEntry;

    fn exec(
        stdout: &str,
        stderr: &str,
        code: Option<i32>,
        signal: Option<i32>,
        timed_out: bool,
    ) -> ExecResult {
        ExecResult {
            stdout: stdout.to_string(),
            stderr: stderr.to_string(),
            code,
            signal,
            timed_out,
            runtime_ms: 0,
        }
    }

    #[test]
    fn exec_success_is_bare_output() {
        let s = format_exec(&exec("hi\n", "", Some(0), None, false));
        assert_eq!(s, "hi\n");
    }

    #[test]
    fn exec_nonzero_exit_and_stderr_are_marked() {
        let s = format_exec(&exec("", "boom\n", Some(1), None, false));
        assert!(s.contains("[stderr]"), "{s:?}");
        assert!(s.contains("[exit 1]"), "{s:?}");
    }

    #[test]
    fn exec_signal_is_marked() {
        let s = format_exec(&exec("", "", None, Some(9), false));
        assert!(s.contains("[signal 9]"), "{s:?}");
        assert!(!s.contains("[timeout]"), "{s:?}");
    }

    #[test]
    fn exec_timeout_is_distinct_from_signal() {
        // A timeout is delivered as a SIGKILL, but must read as a timeout.
        let s = format_exec(&exec("partial", "", None, Some(9), true));
        assert!(s.contains("[timeout]"), "{s:?}");
        assert!(!s.contains("[signal 9]"), "{s:?}");
    }

    #[test]
    fn read_truncation_marker_is_actionable() {
        let r = FsReadResult {
            bytes: vec![b'a'; 1000],
            total: Some(3500),
            truncated: true,
        };
        let s = format_read(&r, 0);
        assert!(s.starts_with('a'), "{s:?}");
        assert!(
            s.contains("[truncated: showing 0..1000 of 3500 bytes; re-read with offset 1000]"),
            "{s:?}"
        );
    }

    #[test]
    fn read_not_truncated_has_no_marker() {
        let r = FsReadResult {
            bytes: b"done".to_vec(),
            total: Some(4),
            truncated: false,
        };
        assert_eq!(format_read(&r, 0), "done");
    }

    #[test]
    fn list_truncation_reports_counts() {
        let res = FsListResult {
            entries: vec![FsEntry {
                name: "a".to_string(),
                kind: EntryKind::File,
                size: 1,
            }],
            total: Some(200),
            truncated: true,
        };
        let s = format_list(&res);
        assert!(s.contains("file\t1\ta"), "{s:?}");
        assert!(s.contains("[truncated: showing 1 of 200 entries]"), "{s:?}");
    }
}
