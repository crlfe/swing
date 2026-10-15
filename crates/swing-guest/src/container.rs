//! Container role (design.md §5.2): the forked child.
//!
//! Optionally sandboxes itself (see `sandbox.rs`), then serves exec/fs frames
//! over its stdin+stdout — the `socketpair` the coordinator handed it. After
//! sandboxing, the workspace is the bind-mounted `/work`; without sandboxing it
//! is the inherited work directory.

use std::io::{self, Read, Write};

use anyhow::Result;
use swing_proto::{Conn, Msg, Stream};

pub fn run(args: &[String]) -> Result<()> {
    let mut id = 0u32;
    let mut work_dir = std::env::current_dir()?.to_string_lossy().into_owned();
    let mut sandbox = false;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--id" => {
                i += 1;
                id = args.get(i).and_then(|s| s.parse().ok()).unwrap_or(0);
            }
            "--work-dir" => {
                i += 1;
                if let Some(w) = args.get(i) {
                    work_dir = w.clone();
                }
            }
            "--sandbox" => sandbox = true,
            _ => {}
        }
        i += 1;
    }

    // After sandboxing the workspace is the bind-mounted /work; otherwise it is
    // the inherited host work dir.
    let work_root = if sandbox {
        crate::sandbox::setup(id, &work_dir)?;
        std::env::set_current_dir("/work").ok();
        "/work".to_string()
    } else {
        std::env::set_current_dir(&work_dir).ok();
        work_dir
    };

    let duplex = Duplex {
        r: std::io::stdin(),
        w: std::io::stdout(),
    };
    let mut conn = Conn::new(duplex);
    eprintln!("container {id} serving (work root: {work_root}, sandbox: {sandbox})");

    while let Some(f) = conn.recv()? {
        match f.msg {
            Msg::ExecStart {
                command,
                cwd,
                timeout_ms,
            } => {
                crate::exec::handle_exec(&mut conn, id, f.call, &command, cwd.as_deref(), timeout_ms)?;
            }
            Msg::ExecCancel => {
                // TODO: cancellation (T3). Not wired in the spike.
            }
            Msg::FsRead { path, offset, limit } => {
                crate::fs::handle_read(&mut conn, id, f.call, &work_root, &path, offset, limit)?;
            }
            Msg::FsWrite { path } => {
                crate::fs::handle_write(&mut conn, id, f.call, &work_root, &path, &f.body)?;
            }
            Msg::FsList { path } => {
                crate::fs::handle_list(&mut conn, id, f.call, &work_root, &path)?;
            }
            Msg::Shutdown => break,
            other => {
                conn.send(
                    Stream::Control,
                    id,
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

/// A single `Read + Write` handle over the child's stdin (reads) and stdout
/// (writes). Both are the same `socketpair` end the coordinator created, so
/// this is a full-duplex framed channel without needing an unsafe fd dup.
struct Duplex {
    r: std::io::Stdin,
    w: std::io::Stdout,
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
