//! Layer-2 tests: path protection through the real control channel.
//!
//! These spawn the actual `swing-guest` coordinator — the same binary and the
//! same socketpair handoff `swing-server::guest::GuestClient` uses — and drive
//! fs/exec frames at it, so the whole chain is exercised: framed protocol ->
//! coordinator routing -> container child -> `fs::resolve_safe`.
//!
//! Every test asserts two halves:
//!
//!   1. the *response* half — the guest answers `bad_path`, not a raw errno;
//!   2. the *filesystem* half — a canary outside the work root is untouched and
//!      nothing new appears outside it.
//!
//! The container is always sandboxed, so these tests run against a real one:
//! the work root is the bind-mounted `/work`, and the scratch tree is what the
//! host sees of it. That means they need bubblewrap installed and unprivileged
//! user namespaces — if bubblewrap fails to set up, the child dies before
//! serving anything and the test fails with the guest's own error in its log.
//! Probing the boundary itself (namespaces, read-only binds, no network) is a
//! separate layer-3 suite, not yet written — see todo.md T14.
//!
//! Everything runs in a per-test scratch dir under the system temp dir, never
//! the real workspace, removed on drop including when a test panics. bubblewrap
//! builds the container root inside its own mount namespace and leaves no
//! new-root directory on the host, so there is no sandbox litter to clean up.

use std::collections::BTreeMap;
use std::fs::{self, File};
use std::os::fd::OwnedFd;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use swing_proto::{Conn, FsEntry, Msg, RecvFrame, Stream};

const GUEST: &str = env!("CARGO_BIN_EXE_swing-guest");

/// The spike's single implicit container id (`GuestClient` uses 1 too).
const CONTAINER_ID: u32 = 1;

/// A sentinel placed in the guest's own environment. `--clearenv` in
/// `sandbox.rs` must keep it out of the container child, so the model's
/// `shell` can never read it back (see `shell_cannot_see_inherited_environment`).
const CANARY_SECRET: &str = "swing-canary-secret-must-not-leak";

/// Generous but finite: a guest that fails to answer a call must fail the test,
/// not hang the run.
const CALL_TIMEOUT: Duration = Duration::from_secs(30);

// ---------------------------------------------------------------- harness ---

struct Guest {
    conn: Conn<UnixStream>,
    child: Child,
    next_call: u32,
    /// Scratch root: `<root>/work` is the work root, `<root>/outside` holds
    /// data the guest must not reach.
    root: PathBuf,
    work: PathBuf,
    outside: PathBuf,
    canary: PathBuf,
    canary_body: &'static [u8],
    /// The guest's stderr, captured to a file instead of inherited. Printed on
    /// failure only; see `Drop`.
    guest_log: PathBuf,
}

impl Guest {
    /// Spawn the coordinator with one end of a socketpair as its stdin+stdout,
    /// exactly as the server does, and complete the Hello/Ready handshake.
    fn new() -> Self {
        let root = scratch("path-protection");
        let work = root.join("work");
        let outside = root.join("outside");
        let canary = outside.join("secret.txt");
        let canary_body = b"host canary - must not be reachable";

        fs::create_dir_all(&work).expect("create work dir");
        fs::create_dir_all(&outside).expect("create outside dir");
        fs::write(&canary, canary_body).expect("write canary");

        let (ours, theirs) = UnixStream::pair().expect("socketpair");
        ours.set_read_timeout(Some(CALL_TIMEOUT))
            .expect("set read timeout on control channel");

        let mut cmd = Command::new(GUEST);
        cmd.arg("--work-dir").arg(&work);
        // Stand in for the server's provider credentials: the coordinator
        // inherits this, and the container child must not (sandbox `--clearenv`).
        cmd.env("SWING_CANARY_SECRET", CANARY_SECRET);
        cmd.stdin(Stdio::from(File::from(OwnedFd::from(
            theirs.try_clone().expect("clone socketpair"),
        ))));
        cmd.stdout(Stdio::from(File::from(OwnedFd::from(theirs))));
        // The guest's stderr goes to a file rather than to our own: the
        // coordinator and every container child write to it, and libtest only
        // captures a test's print macros — a child writing to fd 2 leaks to the
        // terminal and interleaves across parallel tests. A file also has no EOF
        // or buffer-limit problem, which a pipe would (the container children
        // inherit the coordinator's stderr, so a lingering one keeps a pipe
        // open forever). Set SWING_TEST_GUEST_STDERR=1 to watch it live instead.
        let guest_log = root.join("guest.log");
        if std::env::var_os("SWING_TEST_GUEST_STDERR").is_some() {
            cmd.stderr(Stdio::inherit());
        } else {
            cmd.stderr(Stdio::from(File::create(&guest_log).expect("create guest.log")));
        }

        let child = cmd.spawn().expect("spawn swing-guest coordinator");
        let conn = Conn::new(ours);

        // Build the fixture before the handshake: if the handshake fails, `Drop`
        // still reaps the child and removes the scratch dir.
        let mut guest = Guest {
            conn,
            child,
            next_call: 0,
            root,
            work,
            outside,
            canary,
            canary_body,
            guest_log,
        };
        guest.handshake();
        guest
    }

    /// Hello then Ready, the same handshake `GuestClient::spawn` waits for.
    fn handshake(&mut self) {
        let hello = self
            .conn
            .recv()
            .expect("recv hello")
            .expect("coordinator closed before handshake");
        assert!(matches!(hello.msg, Msg::Hello { .. }), "expected hello, got {:?}", hello.msg);
        let ready = self
            .conn
            .recv()
            .expect("recv ready")
            .expect("coordinator closed before ready");
        assert!(matches!(ready.msg, Msg::Ready), "expected ready, got {:?}", ready.msg);
    }

    fn send_call(&mut self, stream: Stream, msg: &Msg, body: Vec<u8>) -> u32 {
        self.next_call += 1;
        let call = self.next_call;
        self.conn
            .send(stream, CONTAINER_ID, call, msg, body)
            .expect("send frame");
        call
    }

    /// Read frames until the one answering `call` arrives.
    fn wait_call(&mut self, call: u32) -> RecvFrame {
        loop {
            let f = self
                .conn
                .recv()
                .expect("recv (guest hung or died mid-call)")
                .expect("guest closed mid-call");
            if f.call == call {
                return f;
            }
        }
    }

    /// Returns `(ok, error_code, body)`.
    fn fs_read(&mut self, path: &str) -> (bool, Option<String>, Vec<u8>) {
        let call = self.send_call(
            Stream::Control,
            &Msg::FsRead { path: path.to_string(), offset: None, limit: None },
            Vec::new(),
        );
        let f = self.wait_call(call);
        match f.msg {
            Msg::FsResult { ok, error, .. } => (ok, error, f.body),
            other => panic!("unexpected fs_read response for {path:?}: {other:?}"),
        }
    }

    fn fs_write(&mut self, path: &str, content: &[u8]) -> (bool, Option<String>) {
        let call = self.send_call(
            Stream::Control,
            &Msg::FsWrite { path: path.to_string() },
            content.to_vec(),
        );
        let f = self.wait_call(call);
        match f.msg {
            Msg::FsResult { ok, error, .. } => (ok, error),
            other => panic!("unexpected fs_write response for {path:?}: {other:?}"),
        }
    }

    fn fs_list(&mut self, path: &str) -> (bool, Option<String>, Vec<FsEntry>) {
        let call = self.send_call(
            Stream::Control,
            &Msg::FsList { path: path.to_string() },
            Vec::new(),
        );
        let f = self.wait_call(call);
        match f.msg {
            Msg::FsResult { ok, error, entries, .. } => (ok, error, entries),
            other => panic!("unexpected fs_list response for {path:?}: {other:?}"),
        }
    }

    /// Returns `(stdout, stderr, exit_code)`.
    fn exec(&mut self, command: &str) -> (String, String, Option<i32>) {
        let call = self.send_call(
            Stream::Exec,
            &Msg::ExecStart { command: command.to_string(), cwd: None, timeout_ms: None },
            Vec::new(),
        );
        let mut out = Vec::new();
        let mut err = Vec::new();
        let code = loop {
            let f = self.wait_call(call);
            match f.msg {
                Msg::ExecOutput { stderr } => {
                    if stderr {
                        err.extend_from_slice(&f.body);
                    } else {
                        out.extend_from_slice(&f.body);
                    }
                }
                // exec_exit is the terminal frame for the call (coordinator
                // `relay` stops there too), so this ends the loop.
                Msg::ExecExit { code, .. } => break code,
                other => panic!("unexpected exec response to {command:?}: {other:?}"),
            }
        };
        (
            String::from_utf8_lossy(&out).into_owned(),
            String::from_utf8_lossy(&err).into_owned(),
            code,
        )
    }

    /// The canary must be byte-identical and unmodified. Checked after every
    /// hostile call.
    fn assert_canary_intact(&self) {
        let meta = fs::metadata(&self.canary).expect("canary vanished");
        let bytes = fs::read(&self.canary).expect("read canary");
        assert_eq!(bytes, self.canary_body, "canary contents changed");
        assert_eq!(meta.len(), self.canary_body.len() as u64, "canary size changed");
    }
}

impl Drop for Guest {
    fn drop(&mut self) {
        // Ask nicely, then reap. The coordinator kills its container children on
        // Shutdown; the kill/wait is the backstop, as in GuestClient.
        let _ = self.conn.send(Stream::Control, 0, 0, &Msg::Shutdown, Vec::new());
        let _ = self.child.kill();
        let _ = self.child.wait();

        // Reap, then read the log, then delete it with the rest of the scratch
        // dir. Only while panicking, so the guest's diagnostics show up for
        // failing tests and are attributed to the right one by libtest. In
        // SWING_TEST_GUEST_STDERR mode there is no log file and the read fails;
        // that output already went to the terminal live.
        if std::thread::panicking() {
            match fs::read_to_string(&self.guest_log) {
                Ok(log) if !log.is_empty() => eprintln!("\n--- swing-guest stderr ---\n{log}"),
                Ok(_) => eprintln!("\n(swing-guest wrote nothing to stderr)"),
                Err(_) => {}
            }
        }

        let _ = fs::remove_dir_all(&self.root);
    }
}

/// Per-test scratch root. Unique per call (pid + nanos) so the parallel test
/// threads `cargo test` runs cannot collide.
fn scratch(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before epoch")
        .as_nanos();
    PathBuf::from(format!(
        "{}/swing-test-{}-{name}-{nanos}",
        std::env::temp_dir().to_string_lossy(),
        std::process::id(),
    ))
}

/// Recursive `(relative path -> size)` listing. The filesystem half of these
/// tests: what the guest did, and did not, create.
fn snapshot(dir: &Path) -> BTreeMap<String, u64> {
    let mut out = BTreeMap::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for entry in fs::read_dir(&d).unwrap_or_else(|e| panic!("read_dir {d:?}: {e}")) {
            let entry = entry.expect("dir entry");
            let rel = entry
                .path()
                .strip_prefix(dir)
                .expect("entry under snapshot root")
                .to_string_lossy()
                .into_owned();
            out.insert(rel, entry.metadata().map(|m| m.len()).unwrap_or(0));
            if entry.file_type().expect("file type").is_dir() {
                stack.push(entry.path());
            }
        }
    }
    out
}

/// Paths a model could plausibly supply. All must be refused, and none may be
/// touched on the way to refusing it.
///
/// These are safe to probe with *every* verb, including write: the only
/// absolute paths here are inside the scratch root, so even a policy regression
/// that allowed them would write into a directory the test deletes, not into
/// the host.
fn hostile_paths(guest: &Guest) -> Vec<String> {
    vec![
        "../outside/secret.txt".to_string(),
        // Two levels up, but from the work root this lands back inside the
        // scratch tree — so it is safe to attempt a write with.
        "a/../../outside/secret.txt".to_string(),
        "..".to_string(),
        // Traversal that resolves back inside the root: still refused, because
        // the policy is component-based, not resolution-based.
        "inside/../notes.txt".to_string(),
        "../work/notes.txt".to_string(),
        // The absolute form of the canary, built at runtime so it names a file
        // that really exists.
        guest.canary.to_string_lossy().into_owned(),
        // An absolute path that is *inside* the scratch tree but outside the
        // work root: the safe stand-in for "absolute path is refused".
        guest.outside.join("smuggled-abs.txt").to_string_lossy().into_owned(),
    ]
}

/// Hostile paths that are only ever *read* or *listed*, never written.
///
/// `/`, `/etc/passwd` and `../../outside/...` are what a hostile model actually
/// reaches for, so they belong in the suite — but probing them with `write`
/// would mean a policy regression writes outside the scratch tree: damaging the
/// host, or at best leaving litter in the system temp dir. Read and list are
/// harmless, so that is how these are probed.
fn hostile_read_only_paths() -> Vec<String> {
    vec![
        "/".to_string(),
        "/etc/passwd".to_string(),
        "/proc/self/environ".to_string(),
        "../../outside/secret.txt".to_string(),
    ]
}

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
/// has no path policy of its own (design.md principle 3 / D-21). Without
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
