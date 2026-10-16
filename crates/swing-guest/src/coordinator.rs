//! Coordinator role (design.md §5.2).
//!
//! Speaks the control channel to `swing-server`, and forks/supervises
//! `swing-guest container` children, routing exec/fs frames to the child that
//! owns the frame's container id. Children are spawned with `Command` and
//! given a `socketpair` as their stdin+stdout; framed messages are forwarded
//! to the child and its response frames relayed back to the server.
//!
//! The server spawns this coordinator and hands it one end of a `socketpair` as
//! its stdin+stdout — the inherited-fd form of the private local control channel
//! (revised D-27). There is no listening socket and no socket file: the inherited
//! fd *is* the capability boundary (D-45/D-46). Production swaps this fd for a
//! virtio-serial chardev (and a DACL'd named pipe on Windows); T3/T13a.

use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read, Write};
use std::os::fd::OwnedFd;
use std::os::unix::net::UnixStream;
use std::process::{Child, Command, Stdio};

use anyhow::{Context, Result};
use swing_proto::{Conn, Msg, Stream};

struct ContainerHandle {
    conn: Conn<UnixStream>,
    child: Child,
}

pub fn run(args: &[String]) -> Result<()> {
    // The server spawns us and hands us one end of a socketpair as our
    // stdin+stdout (the inherited-fd control channel). Flags come from the
    // server; env vars remain as a fallback.
    let mut sandbox = std::env::var("SWING_SANDBOX").map(|v| v == "1").unwrap_or(false);
    let mut work_dir = match std::env::var("SWING_WORK_DIR") {
        Ok(w) => w,
        Err(_) => std::env::current_dir()?.to_string_lossy().into_owned(),
    };

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--sandbox" => sandbox = true,
            "--work-dir" => {
                i += 1;
                if let Some(w) = args.get(i) {
                    work_dir = w.clone();
                }
            }
            _ => {}
        }
        i += 1;
    }

    // Control channel is our inherited stdin+stdout (the server's socketpair
    // end) — the same `Duplex` shape the container children use. No socket file,
    // no listener: the fd *is* the capability boundary (D-45/D-46).
    eprintln!(
        "swing-guest coordinator (inherited channel; work dir: {work_dir}, sandbox: {sandbox})"
    );
    let conn = Conn::new(Duplex {
        r: io::stdin(),
        w: io::stdout(),
    });
    serve(conn, &work_dir, sandbox)
}

/// Handshake, then serve one server connection until it closes.
fn serve<S: Read + Write>(mut conn: Conn<S>, work_dir: &str, sandbox: bool) -> Result<()> {
    // Handshake: build_id pairs with the server build so a version mismatch
    // is a clear error, not garbage (design.md §7 "Versioning").
    conn.send(
        Stream::Control,
        0,
        0,
        &Msg::Hello {
            build_id: "swing-guest spike-1".into(),
        },
        Vec::new(),
    )?;
    conn.send(Stream::Control, 0, 0, &Msg::Ready, Vec::new())?;
    handle(&mut conn, work_dir, sandbox)
}

fn handle<S: Read + Write>(conn: &mut Conn<S>, work_dir: &str, sandbox: bool) -> Result<()> {
    let mut containers: HashMap<u32, ContainerHandle> = HashMap::new();

    while let Some(f) = conn.recv()? {
        // Move the message out so we can forward it while still moving `body`.
        let msg = f.msg;
        match &msg {
            Msg::ExecStart { .. }
            | Msg::ExecCancel
            | Msg::FsRead { .. }
            | Msg::FsWrite { .. }
            | Msg::FsList { .. } => {
                if !containers.contains_key(&f.id) {
                    let h = spawn_container(f.id, work_dir, sandbox)
                        .with_context(|| format!("failed to spawn container {}", f.id))?;
                    containers.insert(f.id, h);
                }
                let h = containers.get_mut(&f.id).expect("just inserted");
                h.conn.send(f.stream, f.id, f.call, &msg, f.body)?;
                relay(conn, &mut h.conn, f.id, f.call)?;
            }

            Msg::ContainerCreate { id } => {
                let id = *id;
                let h = spawn_container(id, work_dir, sandbox)?;
                containers.insert(id, h);
                conn.send(Stream::Control, id, 0, &Msg::ContainerReady { id }, Vec::new())?;
            }

            Msg::ContainerDestroy { id } => {
                if let Some(mut h) = containers.remove(id) {
                    let _ = h.child.kill();
                    let _ = h.child.wait();
                }
            }

            Msg::Shutdown => break,

            other => {
                conn.send(
                    Stream::Control,
                    f.id,
                    f.call,
                    &Msg::Error {
                        code: "unsupported".into(),
                        message: format!("unsupported message: {other:?}"),
                    },
                    Vec::new(),
                )?;
            }
        }
    }

    // Tear down every container child when the server disconnects.
    for (_, mut h) in containers {
        let _ = h.child.kill();
        let _ = h.child.wait();
    }
    Ok(())
}

fn spawn_container(id: u32, work_dir: &str, sandbox: bool) -> Result<ContainerHandle> {
    let (coord_end, child_end) = UnixStream::pair()?;
    let exe = std::env::current_exe()?;

    let mut cmd = Command::new(exe);
    cmd.arg("container")
        .arg("--id")
        .arg(id.to_string())
        .arg("--work-dir")
        .arg(work_dir);
    if sandbox {
        cmd.arg("--sandbox");
    }

    // Give the child the socketpair as its stdin+stdout (same socket, two fds).
    // UnixStream -> OwnedFd -> File -> Stdio (all `From` impls; no fd traits).
    cmd.stdin(Stdio::from(File::from(OwnedFd::from(child_end.try_clone()?))));
    cmd.stdout(Stdio::from(File::from(OwnedFd::from(child_end))));
    cmd.stderr(Stdio::inherit());

    let child = cmd.spawn()?;
    Ok(ContainerHandle {
        conn: Conn::new(coord_end),
        child,
    })
}

/// Relay the child's response frames back to the server until the call's
/// terminal frame (exec_exit / fs_result / error) is seen.
fn relay<S: Read + Write>(
    server: &mut Conn<S>,
    child: &mut Conn<UnixStream>,
    id: u32,
    call: u32,
) -> Result<()> {
    let mut terminal = false;
    while let Some(rf) = child.recv()? {
        let msg = rf.msg;
        let is_term = matches!(
            &msg,
            Msg::ExecExit { .. } | Msg::FsResult { .. } | Msg::Error { .. }
        );
        server.send(rf.stream, rf.id, rf.call, &msg, rf.body)?;
        if is_term {
            terminal = true;
            break;
        }
    }
    if !terminal {
        conn_error(server, id, call, "container_died", "container child closed before responding")?;
    }
    Ok(())
}

fn conn_error<S: Read + Write>(
    server: &mut Conn<S>,
    id: u32,
    call: u32,
    code: &str,
    message: &str,
) -> Result<()> {
    server.send(
        Stream::Control,
        id,
        call,
        &Msg::Error {
            code: code.to_string(),
            message: message.to_string(),
        },
        Vec::new(),
    )?;
    Ok(())
}

/// A single `Read + Write` handle over the coordinator's stdin (reads) and
/// stdout (writes). Both are the same `socketpair` end the server created, so
/// this is a full-duplex framed channel without needing an unsafe fd dup.
struct Duplex {
    r: io::Stdin,
    w: io::Stdout,
}

impl Read for Duplex {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.r.read(buf)
    }
}

impl Write for Duplex {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.w.write(buf)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.w.flush()
    }
}
