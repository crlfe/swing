//! Layer-2 tests: path protection through the real control channel.
//!
//! These drive fs/exec frames at a real sandboxed `swing-guest` container via
//! the shared harness in [`common`]. Every test asserts two halves:
//!
//!   1. the *response* half — the guest answers `bad_path`, not a raw errno;
//!   2. the *filesystem* half — a canary outside the work root is untouched and
//!      nothing new appears outside it.
//!
//! Probing the boundary itself (namespaces, read-only binds, no network) lives
//! in the layer-3 `containment` suite — see todo.md T14.

mod common;

use std::fs;

use common::{hostile_paths, hostile_read_only_paths, snapshot, Guest, CANARY_SECRET};

// ----------------------------------------------------------------- tests ---

/// Read, write and list all refuse the same path set with the same
/// model-actionable code — and the host filesystem is unchanged afterwards.
#[test]
fn fs_calls_refuse_traversal_and_absolute_paths() {
    let mut guest = Guest::new();
    let outside_before = snapshot(&guest.outside);
    let work_before = snapshot(&guest.work);

    // Every verb, on every path that is safe to attempt a write with.
    for path in hostile_paths(&guest) {
        let (ok, error, _) = guest.fs_read(&path);
        assert!(!ok, "read {path:?} was allowed");
        assert_eq!(error.as_deref(), Some("bad_path"), "read {path:?} -> {error:?}");

        let (ok, error) = guest.fs_write(&path, b"smuggled");
        assert!(!ok, "write {path:?} was allowed");
        assert_eq!(error.as_deref(), Some("bad_path"), "write {path:?} -> {error:?}");

        let (ok, error, _) = guest.fs_list(&path);
        assert!(!ok, "list {path:?} was allowed");
        assert_eq!(error.as_deref(), Some("bad_path"), "list {path:?} -> {error:?}");
    }

    // The read-only set: real absolute targets a hostile model reaches for.
    // Refused before anything is opened — note `/proc/self/environ` of the
    // guest would carry its inherited environment, so this is a secret-leak
    // probe as much as a path probe.
    for path in hostile_read_only_paths() {
        let (ok, error, _) = guest.fs_read(&path);
        assert!(!ok, "read {path:?} was allowed");
        assert_eq!(error.as_deref(), Some("bad_path"), "read {path:?} -> {error:?}");

        let (ok, error, _) = guest.fs_list(&path);
        assert!(!ok, "list {path:?} was allowed");
        assert_eq!(error.as_deref(), Some("bad_path"), "list {path:?} -> {error:?}");
    }

    // The filesystem half.
    guest.assert_canary_intact();
    assert_eq!(snapshot(&guest.outside), outside_before, "something appeared outside the work root");
    assert_eq!(snapshot(&guest.work), work_before, "a refused call touched the work root");
}

/// A refused write must create nothing at all — not the target, not a parent
/// directory on the way.
#[test]
fn refused_writes_create_nothing_anywhere() {
    let mut guest = Guest::new();
    let outside_before = snapshot(&guest.outside);
    let work_before = snapshot(&guest.work);

    for path in ["../outside/smuggled.txt", "a/../../outside/smuggled.txt", "../smuggled.txt"] {
        let (ok, error) = guest.fs_write(path, b"smuggled");
        assert!(!ok, "write {path:?} was allowed");
        assert_eq!(error.as_deref(), Some("bad_path"), "write {path:?} -> {error:?}");
    }

    for name in ["smuggled.txt", "outside/smuggled.txt"] {
        let leaked = guest.root.join(name);
        assert!(!leaked.exists(), "{leaked:?} was created by a refused write");
    }
    assert_eq!(snapshot(&guest.outside), outside_before);
    assert_eq!(snapshot(&guest.work), work_before, "a refused write created a directory");
    guest.assert_canary_intact();
}

/// The boundary is a boundary, not a wall: legitimate relative paths must keep
/// working, including nested paths that need parent directories created.
#[test]
fn legitimate_relative_paths_still_work() {
    let mut guest = Guest::new();

    let (ok, error) = guest.fs_write("notes.txt", b"first");
    assert!(ok, "write notes.txt -> {error:?}");
    let (ok, error) = guest.fs_write("a/b/c.txt", b"nested");
    assert!(ok, "write a/b/c.txt -> {error:?}");

    let (ok, error, bytes) = guest.fs_read("notes.txt");
    assert!(ok, "read notes.txt -> {error:?}");
    assert_eq!(bytes, b"first");

    let (ok, error, bytes) = guest.fs_read("a/b/c.txt");
    assert!(ok, "read a/b/c.txt -> {error:?}");
    assert_eq!(bytes, b"nested");

    let (ok, error, entries) = guest.fs_list(".");
    assert!(ok, "list . -> {error:?}");
    // Sorted by name, so the directory `a` created by the nested write shows up
    // alongside the file.
    let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["a", "notes.txt"], "root listing: {entries:?}");

    let (ok, error, entries) = guest.fs_list("a");
    assert!(ok, "list a -> {error:?}");
    assert_eq!(entries.len(), 1, "listing of a: {entries:?}");
    assert_eq!(entries[0].name, "b");

    // And the canary is still exactly what we wrote into it.
    guest.assert_canary_intact();
}

/// A write that fails for a *filesystem* reason is a response, not a teardown:
/// the call comes back with a model-actionable code (not a raw errno, T1) and
/// the same container keeps serving. Exercises both halves — the errno->code
/// mapping in `fs.rs` and the report-and-continue backstop in `container.rs`.
#[test]
fn a_failed_write_is_a_response_not_a_teardown() {
    let mut guest = Guest::new();

    // `dir` is a directory by the time we try to write over it.
    let (ok, error) = guest.fs_write("dir/x.txt", b"nested");
    assert!(ok, "write dir/x.txt -> {error:?}");

    let (ok, error) = guest.fs_write("dir", b"now a file");
    assert!(!ok, "write over a directory was reported as success");
    assert_eq!(error.as_deref(), Some("is_a_directory"), "got {error:?}");

    // The container survived its own failed call: the next call is answered by
    // the same child, and the earlier write is still there.
    let (ok, error, bytes) = guest.fs_read("dir/x.txt");
    assert!(ok, "read after failed write -> {error:?}");
    assert_eq!(bytes, b"nested");

    let (ok, error, entries) = guest.fs_list(".");
    assert!(ok, "list . -> {error:?}");
    assert_eq!(
        entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(),
        ["dir"],
        "root listing: {entries:?}"
    );

    // And the failed write left nothing behind on the host side either: `dir` is
    // still a directory, not a 12-byte file.
    let dir = guest.work.join("dir");
    assert!(dir.is_dir(), "{dir:?} became a file");
    assert_eq!(fs::read(dir.join("x.txt")).expect("read host side"), b"nested");

    guest.assert_canary_intact();
}

/// A refusal is a response, not a teardown: the channel and its container keep
/// serving after one.
#[test]
fn the_channel_survives_a_refused_call() {
    let mut guest = Guest::new();

    let (ok, _, _) = guest.fs_read("../outside/secret.txt");
    assert!(!ok, "traversal read was allowed");

    let (ok, error) = guest.fs_write("notes.txt", b"still working");
    assert!(ok, "write after refusal -> {error:?}");
    let (ok, error, bytes) = guest.fs_read("notes.txt");
    assert!(ok, "read after refusal -> {error:?}");
    assert_eq!(bytes, b"still working");

    let (_, _, code) = guest.exec("true");
    assert_eq!(code, Some(0), "exec after refusal");
    guest.assert_canary_intact();
}

/// The shell is inside the same boundary as the fs tools — by containment, not
/// by policy.
///
/// `fs::resolve_safe` guards only the fs verbs; `exec` runs `sh -c` with no path
/// policy at all (`exec.rs` still discards `cwd` and `timeout_ms`). What bounds
/// the shell is the container: bubblewrap gives the child a private tmpfs root,
/// binds the workspace read-write at `/work`, and starts there. So
/// `../outside/secret.txt` seen by the shell is `/outside/secret.txt` in the
/// container's own root — a path that does not exist — and not the host file
/// the test created.
#[test]
fn shell_cannot_reach_outside_the_work_root() {
    let mut guest = Guest::new();

    // The fs tool refuses it on policy grounds...
    let (ok, error, _) = guest.fs_read("../outside/secret.txt");
    assert!(!ok, "traversal read was allowed");
    assert_eq!(error.as_deref(), Some("bad_path"), "read -> {error:?}");

    // ...the container's cwd is the bind-mounted workspace, not the host path
    // the workspace came from...
    let (stdout, stderr, code) = guest.exec("pwd");
    assert_eq!(code, Some(0), "pwd failed: {stderr}");
    assert_eq!(stdout.trim(), "/work", "container cwd was {:?}", stdout.trim());

    // Precondition for the probes below: the read-only toolchain bind must
    // actually provide `cat`, or "the shell could not read it" proves nothing.
    // If this fails, SWING_SANDBOX_BINDS does not cover the host's coreutils.
    let (stdout, stderr, code) = guest.exec("command -v cat");
    assert_eq!(code, Some(0), "no `cat` in the container (check SWING_SANDBOX_BINDS): {stderr}");
    assert!(!stdout.trim().is_empty(), "cat resolved to nothing: {stdout:?}");

    // ...so the same relative path means something different there, and the
    // host canary is simply not in reach. The exit code and the empty stdout
    // carry the claim; non-zero with *some* stderr means `cat` refused rather
    // than succeeding silently. The wording of the message is host-locale
    // dependent, so it is not asserted.
    let (stdout, stderr, code) = guest.exec("cat ../outside/secret.txt");
    assert_ne!(code, Some(0), "shell read the host canary: {stdout:?}");
    assert!(stdout.is_empty(), "shell leaked canary bytes: {stdout:?}");
    assert!(!stderr.is_empty(), "cat exited {code:?} with no stderr: {stdout:?}");

    // The host path is equally unreachable from inside: the container's /tmp is
    // its own tmpfs, not the host's, so the scratch tree does not exist there.
    let canary = guest.canary.to_string_lossy().into_owned();
    let (stdout, stderr, code) = guest.exec(&format!("cat {canary}"));
    assert_ne!(code, Some(0), "shell read {canary:?}: {stdout:?}");
    assert!(stdout.is_empty(), "shell leaked via absolute path: {stdout:?}");
    assert!(!stderr.is_empty(), "cat exited {code:?} with no stderr: {stdout:?}");

    // And the host side agrees.
    guest.assert_canary_intact();
}

/// The container's `sh` must not inherit the coordinator's environment, which
/// stands in for the server's provider credentials. `--clearenv` in `sandbox.rs`
/// drops it; this proves the model cannot read it back through `shell`, which
/// has no path policy of its own (design principle 3 / D-21). Without
/// `--clearenv` the sentinel set in `Guest::new` would appear in the container.
#[test]
fn shell_cannot_see_inherited_environment() {
    let mut guest = Guest::new();

    // The direct form: the kernel's record of this process's environment.
    let (stdout, stderr, code) = guest.exec("cat /proc/self/environ");
    assert_eq!(code, Some(0), "cat /proc/self/environ failed: {stderr}");
    assert!(
        !stdout.contains(CANARY_SECRET),
        "shell leaked inherited env via /proc/self/environ: {stdout:?}"
    );

    // The indirect form: the shell's own view of its environment.
    let (stdout, _stderr, _code) = guest.exec("env");
    assert!(
        !stdout.contains(CANARY_SECRET),
        "shell leaked inherited env via `env`: {stdout:?}"
    );

    guest.assert_canary_intact();
}

/// read_file honors offset/limit, so a truncated file can actually be paged
/// (the recovery path the tool description promises — todo.md T1).
#[test]
fn read_file_offset_pages_a_truncated_file() {
    let mut guest = Guest::new();

    // Larger than the default read cap (3000) but within the single-frame write
    // budget (MAX_BODY), so one write suffices.
    let body: Vec<u8> = (0..3500u32).map(|i| b'a' + (i % 26) as u8).collect();
    let (ok, error) = guest.fs_write("big.txt", &body);
    assert!(ok, "write big.txt -> {error:?}");

    // First page: a small limit truncates and says so.
    let (ok, error, first, truncated) = guest.fs_read_opts("big.txt", Some(0), Some(1000));
    assert!(ok, "read page 0 -> {error:?}");
    assert!(truncated, "page 0 was not marked truncated");
    assert_eq!(first, &body[..1000], "page 0 bytes");

    // Second page: offset continues exactly where the first left off.
    let (ok, error, second, _) = guest.fs_read_opts("big.txt", Some(1000), Some(1000));
    assert!(ok, "read page 1 -> {error:?}");
    assert_eq!(second, &body[1000..2000], "page 1 bytes");

    guest.assert_canary_intact();
}

/// list_dir truncates a large directory instead of overflowing the frame, and
/// reports the full entry count so the model knows the view is partial (T3).
#[test]
fn list_dir_truncates_a_large_directory() {
    let mut guest = Guest::new();

    // Enough entries to overflow the header budget (~3500 bytes).
    let n = 200;
    for i in 0..n {
        let name = format!("dir/file_{i:03}.txt");
        let (ok, error) = guest.fs_write(&name, b"x");
        assert!(ok, "write {name} -> {error:?}");
    }

    let (ok, error, entries, total, truncated) = guest.fs_list_full("dir");
    assert!(ok, "list dir -> {error:?}");
    assert!(truncated, "a {n}-entry listing was not truncated");
    assert_eq!(total, Some(n as u64), "total entry count");
    assert!(
        entries.len() < n,
        "listing returned all {n} entries despite truncation"
    );

    guest.assert_canary_intact();
}

/// shell honors `timeout`: a long-running command is killed and reported as a
/// distinct timeout, not a generic signal death (design §6). Uses a pure-shell
/// busy loop so it does not depend on any external binary.
#[test]
fn shell_timeout_kills_a_long_command() {
    let mut guest = Guest::new();

    let (stdout, _stderr, code, timed_out, error) =
        guest.exec_opts("while :; do :; done", None, Some(200));
    assert_eq!(error, None, "shell timeout returned an error: {error:?}");
    assert!(
        timed_out,
        "busy loop with a 200ms timeout was not reported as timed_out (code {code:?}, stdout {stdout:?})"
    );
    assert_ne!(code, Some(0), "timed-out command reported success");

    guest.assert_canary_intact();
}

/// shell honors `cwd` (relative to /work) and refuses a cwd that escapes it.
#[test]
fn shell_honors_cwd_and_refuses_escaping_cwd() {
    let mut guest = Guest::new();

    let (ok, error) = guest.fs_write("sub/file.txt", b"inside");
    assert!(ok, "write sub/file.txt -> {error:?}");

    // cwd resolves relative to /work: `cat file.txt` finds the file there.
    let (stdout, stderr, code, _timed_out, err) = guest.exec_opts("cat file.txt", Some("sub"), None);
    assert_eq!(err, None, "cwd exec returned an error: {err:?}");
    assert_eq!(code, Some(0), "cat in cwd failed: {stderr}");
    assert_eq!(stdout, "inside", "cat in cwd read the wrong bytes");

    // pwd reflects the cwd (physical path, independent of any PWD env var).
    let (stdout, stderr, code, _t, err) = guest.exec_opts("pwd -P", Some("sub"), None);
    assert_eq!(err, None, "pwd cwd returned an error: {err:?}");
    assert_eq!(code, Some(0), "pwd failed: {stderr}");
    assert_eq!(stdout.trim(), "/work/sub", "pwd did not reflect cwd: {stdout:?}");

    // An escaping cwd is refused with a model-actionable code, not honored.
    let (_o, _e, _c, _t, err) = guest.exec_opts("cat secret.txt", Some("../outside"), None);
    assert_eq!(
        err.as_deref(),
        Some("bad_path"),
        "escaping cwd was not refused as bad_path: {err:?}"
    );

    guest.assert_canary_intact();
}

/// `shell` must not inherit the control channel as stdin: a command that reads
/// stdin (`cat` with no file) must return promptly on /dev/null, not block on —
/// or consume — protocol frames.
#[test]
fn shell_stdin_is_not_the_control_channel() {
    let mut guest = Guest::new();

    // `cat` with no arguments reads stdin. With stdin redirected to /dev/null it
    // sees EOF immediately; if it inherited the control channel this would hang
    // until the harness read timeout instead of returning.
    let (stdout, stderr, code) = guest.exec("cat");
    assert_eq!(code, Some(0), "`cat` on /dev/null should exit 0: {stderr}");
    assert!(
        stdout.is_empty(),
        "`cat` produced output from a non-null stdin: {stdout:?}"
    );

    guest.assert_canary_intact();
}
