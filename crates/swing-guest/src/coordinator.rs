//! Coordinator role (design.md §5.2).
//!
//! Speaks the control channel to `swing-server`, and forks/supervises
//! `swing-guest container` children, routing exec/fs frames to the child that
//! owns the frame's container id. Children are spawned with `Command` and
//! given a `socketpair` as their stdin+stdout; framed messages are forwarded
//! to the child and its response frames relayed back to the server.

use std::collections::HashMap;
use std::fs::File;
use std::net::{TcpListener, TcpStream};
use std::os::fd::OwnedFd;
use std::os::unix::net::UnixStream;
use std::process::{Child, Command, Stdio};

use anyhow::{Context, Result};
use swing_proto::{Conn, Msg, Stream};

struct ContainerHandle {
    conn: Conn<UnixStream>,
    child: Child,
}

pub fn run() -> Result<()> {
    let addr = std::env::var("SWING_GUEST_ADDR").unwrap_or_else(|_| "127.0.0.1:7700".into());
    // Work dir is the process cwd (spike: no per-ticket workspace mount yet, T4).
    let work_dir = std::env::current_dir()?.to_string_lossy().into_owned();
    // Sandbox is opt-in until it has been verified on-box (T4 / T14).
    let sandbox = std::env::var("SWING_SANDBOX").map(|v| v == "1").unwrap_or(false);

    let listener = TcpListener::bind(&addr)?;
    eprintln!(
        "swing-guest coordinator on {addr} (work dir: {work_dir}, sandbox: {sandbox})"
    );

    // Spike: serve one server connection at a time.
    for stream in listener.incoming() {
        let stream = stream?;
        eprintln!("swing-server connected");
        let mut conn = Conn::new(stream);

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

        if let Err(e) = handle(&mut conn, &work_dir, sandbox) {
            eprintln!("session error: {e:#}");
        }

        eprintln!("client disconnected");
    }
    Ok(())
}

fn handle(conn: &mut Conn<TcpStream>, work_dir: &str, sandbox: bool) -> Result<()> {
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
fn relay(
    server: &mut Conn<TcpStream>,
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

fn conn_error(
    server: &mut Conn<TcpStream>,
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
