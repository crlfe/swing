//! Client to `swing-guest` over the control channel (design §5.2/§6).
//!
//! The server *spawns* `swing-guest` as a child and hands it one end of a
//! `socketpair` as its stdin+stdout — the inherited-fd form of the private local
//! channel (revised D-27). The server owns the child's lifetime.
//!
//! Single-threaded request/response for the spike: each call gets a fresh
//! `call_id`; we read frames until the matching response arrives. Cancellation,
//! concurrent calls, and the bulk stream are deferred (todo.md).
//!
//! Errors are split into two kinds (todo.md T1, tool error recovery):
//! - `GuestError::Rejected` — the guest answered the call with a model-actionable
//!   failure (`bad_path`, `no_such_file`, ...). The caller feeds it back to the
//!   model as text and the attempt continues.
//! - `GuestError::Transport` — the channel or guest itself failed; the attempt
//!   cannot continue.

use std::fs::File;
use std::io;
use std::os::fd::OwnedFd;
use std::os::unix::net::UnixStream;
use std::process::{Child, Command, Stdio};

use anyhow::{anyhow, Context, Result};
use swing_proto::{Conn, FsEntry, Msg, RecvFrame, Stream};

pub struct GuestClient {
    conn: Conn<UnixStream>,
    child: Child,
    next_call: u32,
    /// Container/attempt id. The spike uses a single implicit container.
    id: u32,
}

/// A failure while making a guest call, classified so the caller knows whether
/// the model can act on it or the attempt must end.
#[derive(Debug)]
pub enum GuestError {
    /// The guest answered the call with a model-actionable code. Feed it back to
    /// the model; the attempt continues.
    Rejected(String),
    /// The channel or guest itself failed — the attempt cannot continue.
    Transport(anyhow::Error),
}

/// Adapt a channel I/O error into a transport failure (for `map_err`).
fn transport(e: io::Error) -> GuestError {
    GuestError::Transport(anyhow::Error::new(e))
}

/// Classify an `error` frame. A dead container is an attempt-level failure;
/// every other code is a model-actionable rejection.
fn classify_error(code: &str, message: &str) -> GuestError {
    match code {
        "container_died" => GuestError::Transport(anyhow!("{code}: {message}")),
        _ => GuestError::Rejected(format!("{code}: {message}")),
    }
}

pub struct ExecResult {
    pub stdout: String,
    pub stderr: String,
    pub code: Option<i32>,
    pub signal: Option<i32>,
    pub timed_out: bool,
    pub runtime_ms: u64,
}

pub struct FsReadResult {
    pub bytes: Vec<u8>,
    pub total: Option<u64>,
    pub truncated: bool,
}

pub struct FsListResult {
    pub entries: Vec<FsEntry>,
    /// Total number of entries the guest saw (may exceed `entries` when truncated).
    pub total: Option<u64>,
    pub truncated: bool,
}

impl GuestClient {
    /// Spawn `swing-guest` and wire one end of a `socketpair` to its stdin/stdout.
    ///
    /// There is no sandbox option to pass: the guest sandboxes every container
    /// child unconditionally (T4).
    pub fn spawn(guest_bin: &str, work_dir: &str) -> Result<GuestClient> {
        let (server_end, guest_end) = UnixStream::pair()?;

        let mut cmd = Command::new(guest_bin);
        cmd.arg("--work-dir").arg(work_dir);
        // Defense in depth: the guest never talks to the provider, so it must
        // not hold the API key either. Drop it from the child's environment so
        // the credential never leaves the server process (design principle 3
        // / D-21). The container child is additionally cleared via `--clearenv`
        // in `swing-guest/src/sandbox.rs`.
        cmd.env_remove("OPENAI_API_KEY");
        // Hand the guest one end of the socketpair as its stdin+stdout (same
        // socket, two fds) — UnixStream -> OwnedFd -> File -> Stdio.
        cmd.stdin(Stdio::from(File::from(OwnedFd::from(guest_end.try_clone()?))));
        cmd.stdout(Stdio::from(File::from(OwnedFd::from(guest_end))));
        cmd.stderr(Stdio::inherit());

        let child = cmd
            .spawn()
            .with_context(|| format!("failed to spawn swing-guest at {guest_bin}"))?;

        let mut conn = Conn::new(server_end);

        let hello = conn
            .recv()?
            .ok_or_else(|| anyhow!("guest closed before handshake"))?;
        match hello.msg {
            Msg::Hello { build_id } => eprintln!("guest hello: {build_id}"),
            other => return Err(anyhow!("expected hello, got {other:?}")),
        }
        let ready = conn
            .recv()?
            .ok_or_else(|| anyhow!("guest closed before ready"))?;
        match ready.msg {
            Msg::Ready => {}
            other => return Err(anyhow!("expected ready, got {other:?}")),
        }

        Ok(GuestClient {
            conn,
            child,
            next_call: 0,
            id: 1,
        })
    }

    fn next_call(&mut self) -> u32 {
        self.next_call += 1;
        self.next_call
    }

    pub fn exec(
        &mut self,
        command: &str,
        cwd: Option<&str>,
        timeout_ms: Option<u64>,
    ) -> Result<ExecResult, GuestError> {
        let call = self.next_call();
        self.conn
            .send(
                Stream::Exec,
                self.id,
                call,
                &Msg::ExecStart {
                    command: command.to_string(),
                    cwd: cwd.map(str::to_string),
                    timeout_ms,
                },
                Vec::new(),
            )
            .map_err(transport)?;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        loop {
            let f = self
                .conn
                .recv()
                .map_err(transport)?
                .ok_or_else(|| GuestError::Transport(anyhow!("guest closed during exec")))?;
            if f.call != call {
                continue; // log / unrelated frame
            }
            match f.msg {
                Msg::ExecOutput { stderr: is_err } => {
                    if is_err {
                        stderr.extend_from_slice(&f.body);
                    } else {
                        stdout.extend_from_slice(&f.body);
                    }
                }
                Msg::ExecExit {
                    code,
                    signal,
                    timed_out,
                    runtime_ms,
                } => {
                    return Ok(ExecResult {
                        stdout: String::from_utf8_lossy(&stdout).into_owned(),
                        stderr: String::from_utf8_lossy(&stderr).into_owned(),
                        code,
                        signal,
                        timed_out,
                        runtime_ms,
                    });
                }
                Msg::Error { code, message } => return Err(classify_error(&code, &message)),
                _ => {}
            }
        }
    }

    pub fn fs_read(
        &mut self,
        path: &str,
        offset: Option<u64>,
        limit: Option<u64>,
    ) -> Result<FsReadResult, GuestError> {
        let call = self.next_call();
        self.conn
            .send(
                Stream::Control,
                self.id,
                call,
                &Msg::FsRead {
                    path: path.to_string(),
                    offset,
                    limit,
                },
                Vec::new(),
            )
            .map_err(transport)?;
        let f = self.wait_call(call)?;
        match f.msg {
            Msg::FsResult {
                ok,
                error,
                total,
                truncated,
                ..
            } => {
                if !ok {
                    return Err(GuestError::Rejected(error.unwrap_or_else(|| "error".into())));
                }
                Ok(FsReadResult {
                    bytes: f.body,
                    total,
                    truncated,
                })
            }
            other => Err(GuestError::Transport(anyhow!("unexpected fs response: {other:?}"))),
        }
    }

    pub fn fs_write(&mut self, path: &str, content: &[u8]) -> Result<(), GuestError> {
        let call = self.next_call();
        self.conn
            .send(
                Stream::Control,
                self.id,
                call,
                &Msg::FsWrite {
                    path: path.to_string(),
                },
                content.to_vec(),
            )
            .map_err(transport)?;
        let f = self.wait_call(call)?;
        match f.msg {
            Msg::FsResult { ok, error, .. } => {
                if !ok {
                    return Err(GuestError::Rejected(error.unwrap_or_else(|| "error".into())));
                }
                Ok(())
            }
            other => Err(GuestError::Transport(anyhow!("unexpected fs response: {other:?}"))),
        }
    }

    pub fn fs_list(&mut self, path: &str) -> Result<FsListResult, GuestError> {
        let call = self.next_call();
        self.conn
            .send(
                Stream::Control,
                self.id,
                call,
                &Msg::FsList {
                    path: path.to_string(),
                },
                Vec::new(),
            )
            .map_err(transport)?;
        let f = self.wait_call(call)?;
        match f.msg {
            Msg::FsResult {
                ok,
                error,
                entries,
                total,
                truncated,
            } => {
                if !ok {
                    return Err(GuestError::Rejected(error.unwrap_or_else(|| "error".into())));
                }
                Ok(FsListResult {
                    entries,
                    total,
                    truncated,
                })
            }
            other => Err(GuestError::Transport(anyhow!("unexpected fs response: {other:?}"))),
        }
    }

    fn wait_call(&mut self, call: u32) -> Result<RecvFrame, GuestError> {
        while let Some(f) = self.conn.recv().map_err(transport)? {
            if f.call == call {
                if let Msg::Error { code, message } = &f.msg {
                    return Err(classify_error(code, message));
                }
                return Ok(f);
            }
        }
        Err(GuestError::Transport(anyhow!(
            "guest closed while awaiting call {call}"
        )))
    }

    /// Ask the guest to shut down (so it tears down its container children), then
    /// reap the child as a backstop. The guest also exits on EOF if we just drop.
    pub fn shutdown(mut self) -> Result<()> {
        let _ = self
            .conn
            .send(Stream::Control, 0, 0, &Msg::Shutdown, Vec::new());
        let _ = self.child.kill();
        let _ = self.child.wait();
        Ok(())
    }
}
