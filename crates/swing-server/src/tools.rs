//! Model-facing tool surface (design.md §6, T1).
//!
//! Two layers, kept distinct (design.md §6): the JSON schema the model sees,
//! and the wire primitives sent to `swing-guest`. `dispatch` is the seam.
//!
//! The four v1 tools (D-43): read_file, write_file, list_dir, shell.
//! Results are formatted as model-actionable text: explicit truncation markers,
//! error codes the model can act on — not raw errno.
//!
//! TODO (T1): pin truncation limits/markers, richer error shapes, whether the
//! model learns the workspace layout implicitly (e.g. an implicit list_dir at
//! session start).

use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use crate::guest::GuestClient;

/// OpenAI function-tool specs (D-41: provider tool-schema feature).
pub fn tool_specs() -> Vec<Value> {
    vec![
        json!({
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read a text file under /work. Output may be truncated; a trailing '[truncated]' marker means more exists — re-read with a larger offset.",
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
                "description": "List a directory under /work. Returns entries with type and size.",
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
                "description": "Run a shell command via `sh -c` in the workspace. Returns stdout, stderr, and the exit status.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string", "description": "Shell command string." },
                        "cwd": { "type": "string", "description": "Working directory relative to /work." },
                        "timeout": { "type": "integer", "description": "Timeout in seconds." }
                    },
                    "required": ["command"]
                }
            }
        }),
    ]
}

// TODO (T1, tool error recovery): tool-level failures are handled
// inconsistently, and the bad case aborts the attempt instead of teaching the
// model.
//
//   - read_file catches guest errors and feeds them back as model-actionable
//     text (`[error: no_such_file]`), so the model can see the failure and
//     correct course.
//   - shell / write_file / list_dir propagate errors with `?`. A guest-side
//     rejection (e.g. `bad_path` from `../notes.txt` or `/home/.../test.txt`)
//     bubbles out of dispatch -> session::run_attempt returns Err -> main
//     prints "[attempt error: bad_path]" and the attempt ENDS. The model never
//     sees the error and gets no chance to recover.
//
// Desired: every *tool-level* failure (bad path, no such file, payload too
// large, unknown tool, malformed args) is returned to the model as actionable
// text and recorded in the transcript, exactly like read_file does — reserving
// attempt-level failure for genuine transport/guest-death errors only. Then
// re-test the adversarial prompts (truncation, no_such_file, bad_path, shell
// exit) and confirm the model recovers.
//
// Not fixing now; captured so the next spike iteration addresses it.

/// Execute one tool call and return the text handed back to the model.
pub fn dispatch(name: &str, args: &Value, guest: &mut GuestClient) -> Result<String> {
    match name {
        "shell" => {
            let command = arg_str(args, "command")?;
            let r = guest.exec(command)?;
            let mut out = String::new();
            out.push_str(&r.stdout);
            if !r.stderr.is_empty() {
                if !out.is_empty() {
                    out.push('\n');
                }
                out.push_str("[stderr]\n");
                out.push_str(&r.stderr);
            }
            match (r.code, r.signal) {
                (Some(0), _) => {}
                (Some(c), _) => out.push_str(&format!("\n[exit {c}]")),
                (None, Some(sig)) => out.push_str(&format!("\n[signal {sig}]")),
                (None, None) => out.push_str("\n[timeout]"),
            }
            Ok(out)
        }

        "read_file" => {
            let path = arg_str(args, "path")?;
            match guest.fs_read(path) {
                Ok(r) => {
                    let mut text = String::from_utf8_lossy(&r.bytes).into_owned();
                    if r.truncated {
                        text.push_str("\n[truncated]");
                    }
                    Ok(text)
                }
                // Model-actionable error code (e.g. no_such_file), not a raw errno.
                Err(e) => Ok(format!("[error: {e}]")),
            }
        }

        "write_file" => {
            let path = arg_str(args, "path")?;
            let content = args
                .get("content")
                .and_then(|c| c.as_str())
                .ok_or_else(|| anyhow!("write_file: missing 'content'"))?;
            guest.fs_write(path, content.as_bytes())?;
            Ok(format!("wrote {} bytes to {path}", content.len()))
        }

        "list_dir" => {
            let path = arg_str(args, "path")?;
            let entries = guest.fs_list(path)?;
            if entries.is_empty() {
                return Ok("(empty)".to_string());
            }
            let mut out = String::new();
            for e in entries {
                let kind = match e.kind {
                    swing_proto::EntryKind::File => "file",
                    swing_proto::EntryKind::Dir => "dir",
                    swing_proto::EntryKind::Other => "other",
                };
                out.push_str(&format!("{kind}\t{}\t{}\n", e.size, e.name));
            }
            Ok(out)
        }

        other => Err(anyhow!("unknown tool: {other}")),
    }
}

fn arg_str<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    args.get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("missing string argument '{key}'"))
}
