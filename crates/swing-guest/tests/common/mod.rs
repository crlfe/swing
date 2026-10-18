//! Shared integration-test harness for `swing-guest`.
//!
//! Compiled into each `tests/*.rs` crate via `mod common;` — the
//! `tests/common/mod.rs` convention (a module in a subdirectory) keeps this
//! file from becoming its own test target.
//!
//! It spawns the actual `swing-guest` coordinator — the same binary and the
//! same socketpair handoff `swing-server::guest::GuestClient` uses — and drives
//! fs/exec frames at it, so the whole chain is exercised: framed protocol ->
//! coordinator routing -> container child -> `fs::resolve_safe`.
//!
//! The container is always sandboxed, so tests run against a real one: the
//! work root is the bind-mounted `/work`, and the scratch tree is what the host
//! sees of it. That means they need bubblewrap installed and unprivileged user
//! namespaces — if bubblewrap fails to set up, the child dies before serving
//! anything and the test fails with the guest's own error in its log.
//!
//! Everything runs in a per-test scratch dir under the system temp dir, never
//! the real workspace, removed on drop including when a test panics. bubblewrap
//! builds the container root inside its own mount namespace and leaves no
//! new-root directory on the host, so there is no sandbox litter to clean up.
//!
//! This module is compiled once per test crate that includes it, and not every
//! item is used by every one of them; `#![allow(dead_code)]` silences the
//! resulting per-crate "unused" warnings.

#![allow(dead_code)]

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
pub const CANARY_SECRET: &str = "swing-canary-secret-must-not-leak";

/// Generous but finite: a guest that fails to answer a call must fail the test,
/// not hang the run.
const CALL_TIMEOUT: Duration = Duration::from_secs(30);

// ---------------------------------------------------------------- harness ---

pub struct Guest {
    conn: Conn<UnixStream>,
    child: Child,
    next_call: u32,
    /// Scratch root: `<root>/work` is the work root, `<root>/outside` holds
    /// data the guest must not reach.
    pub root: PathBuf,
    pub work: PathBuf,
    pub outside: PathBuf,
    pub canary: PathBuf,
    canary_body: &'static [u8],
    /// The guest's stderr, captured to a file instead of inherited. Printed on
    /// failure only; see `Drop`.
    guest_log: PathBuf,
}

impl Guest {
    /// Spawn the coordinator with one end of a socketpair as its stdin+stdout,
    /// exactly as the server does, and complete the Hello/Ready handshake.
    pub fn new() -> Self {
        let root = scratch("guest-test");
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
    pub fn fs_read(&mut self, path: &str) -> (bool, Option<String>, Vec<u8>) {
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

    pub fn fs_write(&mut self, path: &str, content: &[u8]) -> (bool, Option<String>) {
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

    pub fn fs_list(&mut self, path: &str) -> (bool, Option<String>, Vec<FsEntry>) {
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

    /// Returns `(stdout, stderr, exit_code)`. A convenience wrapper over
    /// [`exec_opts`] for the common case (no cwd, no timeout). A call the guest
    /// refuses (e.g. a bad cwd) surfaces as `(empty, empty, None)` rather than a
    /// panic.
    pub fn exec(&mut self, command: &str) -> (String, String, Option<i32>) {
        let (stdout, stderr, code, _timed_out, _error) = self.exec_opts(command, None, None);
        (stdout, stderr, code)
    }

    /// fs_read with explicit offset/limit; returns (ok, error, bytes, truncated).
    pub fn fs_read_opts(
        &mut self,
        path: &str,
        offset: Option<u64>,
        limit: Option<u64>,
    ) -> (bool, Option<String>, Vec<u8>, bool) {
        let call = self.send_call(
            Stream::Control,
            &Msg::FsRead {
                path: path.to_string(),
                offset,
                limit,
            },
            Vec::new(),
        );
        let f = self.wait_call(call);
        match f.msg {
            Msg::FsResult {
                ok,
                error,
                truncated,
                ..
            } => (ok, error, f.body, truncated),
            other => panic!("unexpected fs_read response for {path:?}: {other:?}"),
        }
    }

    /// fs_list; returns (ok, error, entries, total, truncated).
    pub fn fs_list_full(
        &mut self,
        path: &str,
    ) -> (bool, Option<String>, Vec<FsEntry>, Option<u64>, bool) {
        let call = self.send_call(
            Stream::Control,
            &Msg::FsList {
                path: path.to_string(),
            },
            Vec::new(),
        );
        let f = self.wait_call(call);
        match f.msg {
            Msg::FsResult {
                ok,
                error,
                entries,
                total,
                truncated,
            } => (ok, error, entries, total, truncated),
            other => panic!("unexpected fs_list response for {path:?}: {other:?}"),
        }
    }

    /// exec with cwd and timeout; returns (stdout, stderr, code, timed_out, error).
    /// `error` is Some(code) when the guest refused the call (e.g. a bad cwd).
    pub fn exec_opts(
        &mut self,
        command: &str,
        cwd: Option<&str>,
        timeout_ms: Option<u64>,
    ) -> (String, String, Option<i32>, bool, Option<String>) {
        let call = self.send_call(
            Stream::Exec,
            &Msg::ExecStart {
                command: command.to_string(),
                cwd: cwd.map(str::to_string),
                timeout_ms,
            },
            Vec::new(),
        );
        let mut out = Vec::new();
        let mut err = Vec::new();
        loop {
            let f = self.wait_call(call);
            match f.msg {
                Msg::ExecOutput { stderr } => {
                    if stderr {
                        err.extend_from_slice(&f.body);
                    } else {
                        out.extend_from_slice(&f.body);
                    }
                }
                Msg::ExecExit { code, timed_out, .. } => {
                    return (
                        String::from_utf8_lossy(&out).into_owned(),
                        String::from_utf8_lossy(&err).into_owned(),
                        code,
                        timed_out,
                        None,
                    );
                }
                Msg::Error { code, .. } => {
                    return (String::new(), String::new(), None, false, Some(code));
                }
                other => panic!("unexpected exec response to {command:?}: {other:?}"),
            }
        }
    }

    /// The canary must be byte-identical and unmodified. Checked after every
    /// hostile call.
    pub fn assert_canary_intact(&self) {
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
pub fn snapshot(dir: &Path) -> BTreeMap<String, u64> {
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
pub fn hostile_paths(guest: &Guest) -> Vec<String> {
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
pub fn hostile_read_only_paths() -> Vec<String> {
    vec![
        "/".to_string(),
        "/etc/passwd".to_string(),
        "/proc/self/environ".to_string(),
        "../../outside/secret.txt".to_string(),
    ]
}
