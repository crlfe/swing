//! fs primitives (design.md §6).
//!
//! Spike: read/write/list against a plain work directory rooted at `work_dir`.
//! Paths are relative to that root and may not escape it.
//!
//! TODO (deferred, tracked in todo.md):
//! - Chunked bulk transfer for large reads/writes (bulk stream) — currently a
//!   single frame, so payloads are capped by MAX_FRAME_SIZE.
//! - `fs.stat`, offset/limit paging beyond a single frame.
//! - The real workspace mount / sandbox (T4).

use std::net::TcpStream;
use std::path::{Component, Path, PathBuf};

use anyhow::Result;
use swing_proto::{Conn, EntryKind, FsEntry, Msg, Stream, MAX_FRAME_SIZE};

const MAX_BODY: usize = MAX_FRAME_SIZE - 256;

/// Default read cap so a single fs_result frame fits the protocol limit. The
/// truncation marker tells the model to re-read with an offset (T1).
const DEFAULT_READ_LIMIT: u64 = 3000;

/// Resolve a model-supplied path against the work root, rejecting absolute
/// paths and any `..` traversal. TODO: canonicalize + verify once the real
/// workspace mount exists.
fn safe_path(work_dir: &str, path: &str) -> Option<PathBuf> {
    let p = Path::new(path);
    if p.as_os_str().is_empty() || p.is_absolute() {
        return None;
    }
    if p.components().any(|c| matches!(c, Component::ParentDir)) {
        return None;
    }
    Some(Path::new(work_dir).join(p))
}

fn send_err(conn: &mut Conn<TcpStream>, id: u32, call: u32, code: &str) -> Result<()> {
    conn.send(
        Stream::Control,
        id,
        call,
        &Msg::FsResult {
            ok: false,
            error: Some(code.to_string()),
            entries: Vec::new(),
            total: None,
            truncated: false,
        },
        Vec::new(),
    )?;
    Ok(())
}

pub fn handle_read(
    conn: &mut Conn<TcpStream>,
    id: u32,
    call: u32,
    work_dir: &str,
    path: &str,
    offset: Option<u64>,
    limit: Option<u64>,
) -> Result<()> {
    let full = match safe_path(work_dir, path) {
        Some(p) => p,
        None => return send_err(conn, id, call, "bad_path"),
    };

    let bytes = match std::fs::read(&full) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return send_err(conn, id, call, "no_such_file")
        }
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            return send_err(conn, id, call, "permission_denied")
        }
        Err(e) => return send_err(conn, id, call, &format!("read_failed: {e}")),
    };

    let offset = (offset.unwrap_or(0) as usize).min(bytes.len());
    let window = &bytes[offset..];
    let limit = limit.unwrap_or(DEFAULT_READ_LIMIT).min(MAX_BODY as u64) as usize;
    let truncated = window.len() > limit;
    let slice = &window[..limit.min(window.len())];

    conn.send(
        Stream::Control,
        id,
        call,
        &Msg::FsResult {
            ok: true,
            error: None,
            entries: Vec::new(),
            total: Some(bytes.len() as u64),
            truncated,
        },
        slice.to_vec(),
    )?;
    Ok(())
}

pub fn handle_write(
    conn: &mut Conn<TcpStream>,
    id: u32,
    call: u32,
    work_dir: &str,
    path: &str,
    body: &[u8],
) -> Result<()> {
    let full = match safe_path(work_dir, path) {
        Some(p) => p,
        None => return send_err(conn, id, call, "bad_path"),
    };
    if body.len() > MAX_BODY {
        // TODO: accept large writes via the bulk stream (bulk.begin/segment/end).
        return send_err(conn, id, call, "payload_too_large");
    }
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&full, body)?;

    conn.send(
        Stream::Control,
        id,
        call,
        &Msg::FsResult {
            ok: true,
            error: None,
            entries: Vec::new(),
            total: Some(body.len() as u64),
            truncated: false,
        },
        Vec::new(),
    )?;
    Ok(())
}

pub fn handle_list(
    conn: &mut Conn<TcpStream>,
    id: u32,
    call: u32,
    work_dir: &str,
    path: &str,
) -> Result<()> {
    // "" or "." means the work root.
    let full = if path.is_empty() || path == "." {
        PathBuf::from(work_dir)
    } else {
        match safe_path(work_dir, path) {
            Some(p) => p,
            None => return send_err(conn, id, call, "bad_path"),
        }
    };

    let read = match std::fs::read_dir(&full) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return send_err(conn, id, call, "no_such_file")
        }
        Err(e) => return send_err(conn, id, call, &format!("list_failed: {e}")),
    };

    let mut entries = Vec::new();
    for entry in read {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let kind = if file_type.is_dir() {
            EntryKind::Dir
        } else if file_type.is_file() {
            EntryKind::File
        } else {
            EntryKind::Other
        };
        let size = if kind == EntryKind::File {
            entry.metadata().map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };
        entries.push(FsEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            kind,
            size,
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));

    conn.send(
        Stream::Control,
        id,
        call,
        &Msg::FsResult {
            ok: true,
            error: None,
            entries,
            total: None,
            truncated: false,
        },
        Vec::new(),
    )?;
    Ok(())
}
