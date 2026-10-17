//! Client to `swing-guest` over the control channel (design.md §5.2/§6).
//!
//! The server *spawns* `swing-guest` as a child and hands it one end of a
//! `socketpair` as its stdin+stdout — the inherited-fd form of the private local
//! channel (revised D-27). The server owns the child's lifetime.
//!
//! Single-threaded request/response for the spike: each call gets a fresh
//! `call_id`; we read frames until the matching response arrives. Cancellation,
//! concurrent calls, and the bulk stream are deferred (todo.md).

use std::fs::File;
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

pub struct ExecResult {
    pub stdout: String,
    pub stderr: String,
    pub code: Option<i32>,
    pub signal: Option<i32>,
    pub runtime_ms: u64,
}

pub struct FsReadResult {
    pub bytes: Vec<u8>,
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

    pub fn exec(&mut self, command: &str) -> Result<ExecResult> {
        let call = self.next_call();
        self.conn.send(
            Stream::Exec,
            self.id,
            call,
            &Msg::ExecStart {
                command: command.to_string(),
                cwd: None,
                timeout_ms: None,
            },
            Vec::new(),
        )?;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        loop {
            let f = self
                .conn
                .recv()?
                .ok_or_else(|| anyhow!("guest closed during exec"))?;
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
                    runtime_ms,
                } => {
                    return Ok(ExecResult {
                        stdout: String::from_utf8_lossy(&stdout).into_owned(),
                        stderr: String::from_utf8_lossy(&stderr).into_owned(),
                        code,
                        signal,
                        runtime_ms,
                    });
                }
                Msg::Error { code, message } => return Err(anyhow!("{code}: {message}")),
                _ => {}
            }
        }
    }

    pub fn fs_read(&mut self, path: &str) -> Result<FsReadResult> {
        let call = self.next_call();
        self.conn.send(
            Stream::Control,
            self.id,
            call,
            &Msg::FsRead {
                path: path.to_string(),
                offset: None,
                limit: None,
            },
            Vec::new(),
        )?;
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
                    return Err(anyhow!(error.unwrap_or_else(|| "error".into())));
                }
                Ok(FsReadResult {
                    bytes: f.body,
                    total,
                    truncated,
                })
            }
            other => Err(anyhow!("unexpected fs response: {other:?}")),
        }
    }

    pub fn fs_write(&mut self, path: &str, content: &[u8]) -> Result<()> {
        let call = self.next_call();
        self.conn.send(
            Stream::Control,
            self.id,
            call,
            &Msg::FsWrite {
                path: path.to_string(),
            },
            content.to_vec(),
        )?;
        let f = self.wait_call(call)?;
        match f.msg {
            Msg::FsResult { ok, error, .. } => {
                if !ok {
                    return Err(anyhow!(error.unwrap_or_else(|| "error".into())));
                }
                Ok(())
            }
            other => Err(anyhow!("unexpected fs response: {other:?}")),
        }
    }

    pub fn fs_list(&mut self, path: &str) -> Result<Vec<FsEntry>> {
        let call = self.next_call();
        self.conn.send(
            Stream::Control,
            self.id,
            call,
            &Msg::FsList {
                path: path.to_string(),
            },
            Vec::new(),
        )?;
        let f = self.wait_call(call)?;
        match f.msg {
            Msg::FsResult {
                ok,
                error,
                entries,
                ..
            } => {
                if !ok {
                    return Err(anyhow!(error.unwrap_or_else(|| "error".into())));
                }
                Ok(entries)
            }
            other => Err(anyhow!("unexpected fs response: {other:?}")),
        }
    }

    fn wait_call(&mut self, call: u32) -> Result<RecvFrame> {
        while let Some(f) = self.conn.recv()? {
            if f.call == call {
                if let Msg::Error { code, message } = &f.msg {
                    return Err(anyhow!("{code}: {message}"));
                }
                return Ok(f);
            }
        }
        Err(anyhow!("guest closed while awaiting call {call}"))
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
