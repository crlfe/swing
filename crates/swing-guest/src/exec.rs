//! exec primitives (design.md §6).
//!
//! Spike: run `sh -c <command>` to completion, stream stdout/stderr as
//! `exec_output` frames (chunked to fit MAX_FRAME_SIZE), then one `exec_exit`.
//!
//! TODO (deferred, tracked in todo.md):
//! - Incremental streaming while the process runs (currently reads to EOF).
//! - `exec_cancel` (cancellation) and `timeout_ms` enforcement.
//! - Distinguish signal vs. non-zero exit on non-unix platforms.
//! - Per-container cwd / sandbox (T4 — currently runs in the coordinator's cwd).

use std::io::Read;
use std::net::TcpStream;
use std::process::{Command, Stdio};
use std::time::Instant;

use anyhow::Result;
use swing_proto::{Conn, Msg, Stream, MAX_FRAME_SIZE};

/// Body budget so the whole frame (fixed header + JSON header + body) stays
/// within MAX_FRAME_SIZE. The JSON header for exec_output is small; 256 bytes
/// of slack is generous.
const MAX_BODY: usize = MAX_FRAME_SIZE - 256;

pub fn handle_exec(
    conn: &mut Conn<TcpStream>,
    id: u32,
    call: u32,
    command: &str,
    cwd: Option<&str>,
    timeout_ms: Option<u64>,
) -> Result<()> {
    let _ = (cwd, timeout_ms); // TODO: honor cwd and timeout.

    let start = Instant::now();
    let mut child = Command::new("sh")
        .arg("-c")
        .arg(command)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let mut stdout = child.stdout.take().expect("stdout piped");
    let mut stderr = child.stderr.take().expect("stderr piped");

    // TODO: stream incrementally instead of reading to EOF.
    let mut out = Vec::new();
    let mut err = Vec::new();
    stdout.read_to_end(&mut out)?;
    stderr.read_to_end(&mut err)?;
    let status = child.wait()?;

    send_chunks(conn, id, call, false, &out)?;
    send_chunks(conn, id, call, true, &err)?;

    #[cfg(unix)]
    let signal = {
        use std::os::unix::process::ExitStatusExt;
        status.signal()
    };
    #[cfg(not(unix))]
    let signal = None;

    let runtime_ms = start.elapsed().as_millis() as u64;
    conn.send(
        Stream::Exec,
        id,
        call,
        &Msg::ExecExit {
            code: status.code(),
            signal,
            runtime_ms,
        },
        Vec::new(),
    )?;
    Ok(())
}

fn send_chunks(
    conn: &mut Conn<TcpStream>,
    id: u32,
    call: u32,
    stderr: bool,
    data: &[u8],
) -> Result<()> {
    if data.is_empty() {
        return Ok(());
    }
    for chunk in data.chunks(MAX_BODY) {
        conn.send(Stream::Exec, id, call, &Msg::ExecOutput { stderr }, chunk.to_vec())?;
    }
    Ok(())
}
