//! fs primitives (design §6).
//!
//! Read/write/list against a work directory rooted at `work_root`. Paths are
//! relative to that root and may not escape it. The container always runs
//! sandboxed, so the root is the bind-mounted `/work` (see `container.rs`).
//!
//! Every verb answers its own call. A refused path, an oversized body and a
//! filesystem errno all come back as `fs_result { ok: false, error: <code> }`
//! with a model-actionable code (`fs_error_code`), so nothing unwinds out of
//! the handler and out of the container child — a failed call is a response,
//! not a teardown.
//!
//! TODO (deferred, tracked in todo.md):
//! - Chunked bulk transfer for large reads/writes (bulk stream) — currently a
//!   single frame, so payloads are capped by MAX_FRAME_SIZE.
//! - `fs_list` truncation. `entries` lives in the JSON header, so a directory of
//!   roughly 80 entries overflows MAX_FRAME_SIZE and `write_frame` fails: the
//!   call comes back `call_failed` rather than a partial listing, and
//!   `truncated` is hardcoded false. Cap the entries and set `truncated`, or
//!   move listings to the bulk stream.
//! - `fs.stat`, offset/limit paging beyond a single frame.
//! - `openat2(RESOLVE_NO_SYMLINKS)`: it would replace the canonicalize-then-open
//!   dance in `resolve_safe` and close its TOCTOU window. Explore before the
//!   real workspace mount lands.
//!
//! Path protection is split in two: `path_policy_ok` is the lexical policy
//! (rejects absolute paths and any `..` component), and `resolve_safe` adds a
//! filesystem resolve-and-verify step that canonicalizes the work root and the
//! path and refuses anything landing outside it — so a symlink inside the work
//! root cannot point outside it.

use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use anyhow::Result;
use swing_proto::{Conn, EntryKind, FsEntry, Msg, Stream, MAX_BODY};

/// Default read cap so a single fs_result frame fits the protocol limit. The
/// truncation marker tells the model to re-read with an offset (T1).
const DEFAULT_READ_LIMIT: u64 = 3000;

/// Budget for the `entries` array of an `fs_list` result. `entries` live in the
/// JSON header, so a large directory overflows MAX_FRAME_SIZE and fails the
/// whole call (todo.md T3). Keep only what fits and mark the listing truncated.
const LIST_HEADER_BUDGET: usize = 3500;

/// The lexical path policy: reject empty paths, absolute paths, and any `..`
/// component. Deliberately stricter than "resolves inside the root": `foo/../bar`
/// is refused even though it resolves back inside, because the policy is
/// component-based, not resolution-based. Pure — no filesystem access.
fn path_policy_ok(path: &str) -> bool {
    let p = Path::new(path);
    if p.as_os_str().is_empty() || p.is_absolute() {
        return false;
    }
    !p.components().any(|c| matches!(c, Component::ParentDir))
}

/// Resolve a model-supplied path against the work root and verify it stays
/// inside it: apply `path_policy_ok`, then canonicalize the root and the path so
/// a symlink pointing outside the root cannot escape. Returns the canonicalized
/// path, or `None` if refused.
///
/// `pub(crate)` so `exec` can resolve its `cwd` with the same policy.
///
/// Not race-free (canonicalize-then-open); the race-free form is
/// `openat2(RESOLVE_NO_SYMLINKS)`. The container boundary is the primary wall.
pub(crate) fn resolve_safe(work_root: &str, path: &str) -> Option<PathBuf> {
    if !path_policy_ok(path) {
        return None;
    }
    // Resolve the root itself: it may be a symlink or have symlinked ancestors,
    // and containment must be checked against the real directory.
    let root = std::fs::canonicalize(work_root).ok()?;
    let joined = root.join(path);

    // Resolve symlinks. If the target exists, `canonicalize` follows every
    // symlink in it — including a symlink at the final component. If it does not
    // exist yet (a write creating a new file), resolve the deepest existing
    // ancestor instead and re-attach the not-yet-existing tail.
    let resolved = match std::fs::canonicalize(&joined) {
        Ok(r) => r,
        Err(_) => resolve_existing_prefix(&root, &joined)?,
    };

    // `Path::starts_with` is component-wise, so `/work2` never "starts_with"
    // `/work` — no string-prefix bug.
    resolved.starts_with(&root).then_some(resolved)
}

/// Canonicalize the deepest existing ancestor of `joined` and re-attach the
/// missing tail. Returns `None` if that ancestor resolves outside `root` (an
/// escaping symlink in the path's existing prefix).
fn resolve_existing_prefix(root: &Path, joined: &Path) -> Option<PathBuf> {
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    let mut cur = joined.to_path_buf();
    loop {
        if let Ok(canon) = std::fs::canonicalize(&cur) {
            if !canon.starts_with(root) {
                return None;
            }
            let mut rebuilt = canon;
            for name in tail.iter().rev() {
                rebuilt = rebuilt.join(name);
            }
            return Some(rebuilt);
        }
        // `joined` is `root.join(path)` and `root` exists, so the walk stops at
        // or below `root` and never climbs above it. Each name is pushed before
        // climbing so the rebuild above can re-attach the missing tail.
        tail.push(cur.file_name()?.to_os_string());
        cur = cur.parent()?.to_path_buf();
    }
}

fn send_err<S: Read + Write>(conn: &mut Conn<S>, id: u32, call: u32, code: &str) -> Result<()> {
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

/// errno -> the model-actionable code the model acts on (T1; `schema.toml`'s
/// note on `fs_result`: a code, never a raw errno). Unknown errnos collapse to
/// `fs_failed` — an unknown *code* is still a stable one the server can log,
/// while the errno itself goes to the guest log for the human reading it.
///
/// The `ErrorKind` arm is the primary mapping; the errno arm below is a
/// fallback for kinds std does not classify (`EISDIR`/`ENOTDIR` were only
/// mapped to a kind in std 1.83), so an unmapped errno still never reaches the
/// model verbatim.
fn fs_error_code(e: &std::io::Error) -> &'static str {
    use std::io::ErrorKind::*;
    match e.kind() {
        NotFound => "no_such_file",
        PermissionDenied => "permission_denied",
        IsADirectory => "is_a_directory",
        NotADirectory => "not_a_directory",
        AlreadyExists => "already_exists",
        StorageFull => "no_space",
        _ => match e.raw_os_error() {
            Some(libc::EISDIR) => "is_a_directory",
            Some(libc::ENOTDIR) => "not_a_directory",
            Some(libc::EEXIST) => "already_exists",
            Some(libc::ENOSPC) => "no_space",
            _ => "fs_failed",
        },
    }
}

pub fn handle_read<S: Read + Write>(
    conn: &mut Conn<S>,
    id: u32,
    call: u32,
    work_root: &str,
    path: &str,
    offset: Option<u64>,
    limit: Option<u64>,
) -> Result<()> {
    let full = match resolve_safe(work_root, path) {
        Some(p) => p,
        None => return send_err(conn, id, call, "bad_path"),
    };

    let bytes = match std::fs::read(&full) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("fs read {path:?} ({full:?}) -> {e}");
            return send_err(conn, id, call, fs_error_code(&e));
        }
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

pub fn handle_write<S: Read + Write>(
    conn: &mut Conn<S>,
    id: u32,
    call: u32,
    work_root: &str,
    path: &str,
    body: &[u8],
) -> Result<()> {
    let full = match resolve_safe(work_root, path) {
        Some(p) => p,
        None => return send_err(conn, id, call, "bad_path"),
    };
    if body.len() > MAX_BODY {
        // TODO: accept large writes via the bulk stream (bulk.begin/segment/end).
        return send_err(conn, id, call, "payload_too_large");
    }
    if let Some(parent) = full.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            eprintln!("fs write {path:?}: create_dir_all({parent:?}) -> {e}");
            return send_err(conn, id, call, fs_error_code(&e));
        }
    }
    if let Err(e) = std::fs::write(&full, body) {
        eprintln!("fs write {path:?} ({full:?}) -> {e}");
        return send_err(conn, id, call, fs_error_code(&e));
    }

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

pub fn handle_list<S: Read + Write>(
    conn: &mut Conn<S>,
    id: u32,
    call: u32,
    work_root: &str,
    path: &str,
) -> Result<()> {
    // "" means the work root: normalize it to "." so a listing of the root goes
    // through the same resolve-and-verify path as every other listing.
    let path = if path.is_empty() { "." } else { path };
    let full = match resolve_safe(work_root, path) {
        Some(p) => p,
        None => return send_err(conn, id, call, "bad_path"),
    };

    let read = match std::fs::read_dir(&full) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("fs list {path:?} ({full:?}) -> {e}");
            return send_err(conn, id, call, fs_error_code(&e));
        }
    };

    let mut entries = Vec::new();
    for entry in read {
        // A failure mid-listing is still an answer to this call: nothing has
        // been sent yet, so report it and leave the channel serving.
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                eprintln!("fs list {path:?}: readdir entry -> {e}");
                return send_err(conn, id, call, fs_error_code(&e));
            }
        };
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(e) => {
                eprintln!("fs list {path:?}: file_type -> {e}");
                return send_err(conn, id, call, fs_error_code(&e));
            }
        };
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
    let total = entries.len() as u64;

    // `entries` travel in the JSON header, so a large directory can overflow
    // MAX_FRAME_SIZE and fail the whole call (todo.md T3). Keep only what fits
    // and mark the listing truncated so the model knows the view is partial.
    let mut kept = Vec::new();
    let mut used = 0usize;
    let mut truncated = false;
    for e in entries {
        // +1 for the comma separator between array elements.
        let cost = serde_json::to_string(&e).map(|s| s.len()).unwrap_or(usize::MAX) + 1;
        if used + cost > LIST_HEADER_BUDGET {
            truncated = true;
            break;
        }
        used += cost;
        kept.push(e);
    }

    conn.send(
        Stream::Control,
        id,
        call,
        &Msg::FsResult {
            ok: true,
            error: None,
            entries: kept,
            total: Some(total),
            truncated,
        },
        Vec::new(),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The lexical path policy, pinned as a table.
    ///
    /// *Any* `..` component is rejected, including `foo/../bar`, which would
    /// resolve back inside the root.
    #[test]
    fn path_policy() {
        let cases: &[(&str, bool)] = &[
            // Accepted: plain relative paths.
            ("notes.txt", true),
            ("a/b/c.txt", true),
            ("./x", true),
            ("a/./b", true),
            ("a/", true),
            // Rejected: absolute paths (the root is not addressable directly).
            ("/etc/passwd", false),
            ("/", false),
            // Rejected: traversal.
            ("../escape", false),
            ("a/../../b", false),
            ("..", false),
            ("a/..", false),
            ("a/../../", false),
            // Rejected: empty. `handle_list` normalizes "" to "." before
            // resolve_safe; nothing else may address it.
            ("", false),
            // Rejected: traversal that would resolve back inside the root.
            ("foo/../bar", false),
        ];
        for &(path, expect_ok) in cases {
            let got = path_policy_ok(path);
            assert_eq!(got, expect_ok, "path_policy_ok({path:?}) -> {got}");
        }
    }

    /// Accepted relative paths resolve to a real location under the work root.
    #[test]
    fn accepted_paths_stay_under_the_root() {
        let dir = scratch("accepted");
        let work = dir.join("work");
        let work_root = work.to_string_lossy().into_owned();
        let root = std::fs::canonicalize(&work).expect("canonicalize scratch root");

        for path in ["notes.txt", "a/b/c.txt", "./x", "a/./b"] {
            let full = resolve_safe(&work_root, path)
                .unwrap_or_else(|| panic!("{path:?} was rejected"));
            assert!(full.starts_with(&root), "{path:?} escaped {root:?}: {full:?}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// `.` is accepted and, because `resolve_safe` canonicalizes, normalised to
    /// the root itself.
    #[test]
    fn dot_resolves_to_the_root() {
        let dir = scratch("dot");
        let work = dir.join("work");
        let work_root = work.to_string_lossy().into_owned();
        let full = resolve_safe(&work_root, ".").unwrap_or_else(|| panic!("\".\" was rejected"));
        assert_eq!(full, std::fs::canonicalize(&work).expect("canonicalize scratch root"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A path whose target does not exist yet must resolve to the full joined
    /// path, not to the deepest existing ancestor: a resolution that collapses
    /// to an ancestor turns a write to a new file into a write to its parent
    /// directory (`EISDIR`). Assert the exact path, then do the write.
    #[test]
    fn missing_tail_is_reattached() {
        let dir = scratch("missing-tail");
        let work = dir.join("work");
        let work_root = work.to_string_lossy().into_owned();
        let root = std::fs::canonicalize(&work).expect("canonicalize scratch root");

        for path in ["notes.txt", "a/b/c.txt"] {
            let full = resolve_safe(&work_root, path)
                .unwrap_or_else(|| panic!("{path:?} was rejected"));
            assert_eq!(full, root.join(path), "{path:?} resolved to {full:?}");
        }

        let full = resolve_safe(&work_root, "a/b/c.txt").expect("resolve a/b/c.txt");
        std::fs::create_dir_all(full.parent().expect("parent")).expect("create parents");
        std::fs::write(&full, b"nested").expect("write");
        assert_eq!(std::fs::read(&full).expect("read back"), b"nested");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A per-test scratch tree under the temp dir: `<dir>/work` is the work
    /// root, `<dir>/outside` stands in for data the container must not reach.
    /// Unique per call (pid + nanos) so parallel test threads cannot collide.
    fn scratch(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock before epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "swing-fs-test-{}-{name}-{nanos}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("work")).expect("create work dir");
        std::fs::create_dir_all(dir.join("outside")).expect("create outside dir");
        dir
    }

    /// A symlink inside the work root must not be a way out. `link` and
    /// `rel/link` pass the lexical policy (relative, no `..`); `resolve_safe`
    /// canonicalizes them and refuses the result because it lands outside the
    /// root. One target is an absolute symlink, one relative
    /// (`../../outside/...` from `work/rel` climbs out to `dir/outside`).
    #[test]
    fn symlink_inside_work_root_cannot_escape() {
        let dir = scratch("symlink");
        let work = dir.join("work");
        let secret = dir.join("outside/secret.txt");
        std::fs::write(&secret, b"host canary").expect("write canary");

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            std::fs::create_dir_all(work.join("rel")).expect("create work/rel");
            symlink(&secret, work.join("link")).expect("absolute symlink");
            symlink("../../outside/secret.txt", work.join("rel/link")).expect("relative symlink");
        }

        let work_root = work.to_string_lossy().into_owned();
        let outcomes: Vec<(&str, Option<PathBuf>, Option<Vec<u8>>)> = ["link", "rel/link"]
            .into_iter()
            .map(|path| {
                let full = resolve_safe(&work_root, path);
                let bytes = full.as_ref().and_then(|p| std::fs::read(p).ok());
                (path, full, bytes)
            })
            .collect();

        // Clean up before asserting so a failing run leaves nothing behind.
        let _ = std::fs::remove_dir_all(&dir);

        for (path, full, bytes) in outcomes {
            assert!(
                full.is_none() || bytes.is_none(),
                "symlink escape: {path:?} resolved to {full:?} and read {:?}",
                bytes.map(|b| String::from_utf8_lossy(&b).into_owned()),
            );
        }
    }
}
