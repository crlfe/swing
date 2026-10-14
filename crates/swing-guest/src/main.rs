//! swing-guest (spike): a coordinator that speaks the control-channel protocol
//! over one loopback TCP socket and serves exec/fs requests against a plain
//! work directory.
//!
//! Spike scope (todo.md "First step"): no `unshare`, no container fork, no
//! cgroups — exec/fs run against a plain directory (T4 deferred). The framed
//! server<->guest boundary is real from day 1 so the later virtio-serial swap
//! is a config change, not a rewrite.
//!
//! Production shape (design.md §5.2): the coordinator forks `swing-guest
//! container ...` children via `std::process::Command` (never `fork()` from an
//! async runtime); the child does its own unshare/mount before exec'ing. That
//! is deferred here.

mod exec;
mod fs;

use std::net::TcpListener;

use anyhow::Result;
use swing_proto::{Conn, Msg, Stream};

fn main() -> Result<()> {
    let addr = std::env::var("SWING_GUEST_ADDR").unwrap_or_else(|_| "127.0.0.1:7700".into());
    // Work dir is the process cwd (spike: no per-ticket workspace mount yet, T4).
    let work_dir = std::env::current_dir()?.to_string_lossy().into_owned();

    let listener = TcpListener::bind(&addr)?;
    eprintln!("swing-guest listening on {addr} (work dir: {work_dir})");

    // Spike: serve one client at a time. Production multiplexes many
    // containers per coordinator (design.md §5.2).
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
                build_id: "swing-guest spike-0".into(),
            },
            Vec::new(),
        )?;
        conn.send(Stream::Control, 0, 0, &Msg::Ready, Vec::new())?;

        if let Err(e) = handle(&mut conn, &work_dir) {
            eprintln!("session error: {e:#}");
        }
        eprintln!("client disconnected");
    }
    Ok(())
}

fn handle(conn: &mut Conn<std::net::TcpStream>, work_dir: &str) -> Result<()> {
    while let Some(f) = conn.recv()? {
        match f.msg {
            Msg::ExecStart {
                command,
                cwd,
                timeout_ms,
            } => exec::handle_exec(conn, f.id, f.call, &command, cwd.as_deref(), timeout_ms)?,

            Msg::FsRead { path, offset, limit } => {
                fs::handle_read(conn, f.id, f.call, work_dir, &path, offset, limit)?
            }
            Msg::FsWrite { path } => fs::handle_write(conn, f.id, f.call, work_dir, &path, &f.body)?,
            Msg::FsList { path } => fs::handle_list(conn, f.id, f.call, work_dir, &path)?,

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
    Ok(())
}
