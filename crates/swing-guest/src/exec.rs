//! exec primitives (design.md §6).
//!
//! Run `sh -c <command>` to completion, stream stdout/stderr as `exec_output`
//! frames (chunked to fit MAX_FRAME_SIZE), then one `exec_exit`. Runs in the
//! container child's cwd (the workspace) unless `cwd` names a directory inside
//! it.
//!
//! `cwd` is resolved against the workspace with the same path policy the fs
//! verbs use (`fs::resolve_safe`), so a `cwd` of `../etc` is refused rather
//! than silently honored. `timeout_ms` is enforced with a wall-clock deadline:
//! a killer thread SIGKILLs the child if it outlives the deadline, and the
//! result is reported with `timed_out: true` so a timeout stays distinct from a
//! genuine signal death (design.md §6).
//!
//! stdout and stderr are drained concurrently so a child that floods one pipe
//! cannot deadlock the reader of the other.
//!
//! TODO (deferred, tracked in todo.md):
//! - Incremental streaming while the process runs (currently reads to EOF).
//! - `exec_cancel` (cancellation) (T3).

use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use anyhow::Result;
use swing_proto::{Conn, Msg, Stream, MAX_BODY};

pub fn handle_exec<S: Read + Write>(
    conn: &mut Conn<S>,
    id: u32,
    call: u32,
    command: &str,
    cwd: Option<&str>,
    timeout_ms: Option<u64>,
) -> Result<()> {
    // Resolve `cwd` against the container's workspace (its cwd is /work) with
    // the fs path policy. A refused or non-directory cwd is a model-actionable
    // error response, not a teardown.
    let work_root = std::env::current_dir()?;
    let work_root = work_root.to_string_lossy().into_owned();
    let dir = match cwd {
        Some(c) => match crate::fs::resolve_safe(&work_root, c) {
            Some(p) if p.is_dir() => Some(p),
            Some(p) if p.exists() => {
                return send_exec_err(conn, id, call, "is_a_directory", "cwd is not a directory")
            }
            Some(_) => return send_exec_err(conn, id, call, "no_such_file", "cwd does not exist"),
            None => return send_exec_err(conn, id, call, "bad_path", "cwd escapes the workspace"),
        },
        None => None,
    };

    let start = Instant::now();
    let mut cmd = Command::new("sh");
    cmd.arg("-c")
        .arg(command)
        // The container child's inherited stdin is the framed control channel
        // itself. A command that reads stdin (`cat`, `read`, ...) would consume
        // protocol frames or deadlock against the coordinator's read loop, so
        // stdin is /dev/null. (`exec.stdin` is a future wire primitive, §6.)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(d) = &dir {
        cmd.current_dir(d);
    }
    let mut child = cmd.spawn()?;

    let mut stdout = child.stdout.take().expect("stdout piped");
    let mut stderr = child.stderr.take().expect("stderr piped");

    // Drain stdout on a helper thread while this thread drains stderr, so a full
    // pipe on either side cannot deadlock the other.
    let stdout_thread = thread::spawn(move || {
        let mut v = Vec::new();
        let _ = stdout.read_to_end(&mut v); // partial output is fine on a kill
        v
    });

    // Timeout enforcement. The killer waits up to the deadline for the child to
    // finish (the `done` channel closes when this function drops its sender);
    // if the deadline elapses first it SIGKILLs the child, which closes the
    // pipes and unblocks the reads above.
    let timed_out = Arc::new(AtomicBool::new(false));
    let (done_tx, done_rx) = mpsc::channel::<()>();
    let pid = child.id();
    let killer = timeout_ms.map(|ms| {
        let timed_out = Arc::clone(&timed_out);
        thread::spawn(move || {
            match done_rx.recv_timeout(Duration::from_millis(ms)) {
                Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => {}
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    timed_out.store(true, Ordering::SeqCst);
                    unsafe {
                        libc::kill(pid as libc::pid_t, libc::SIGKILL);
                    }
                }
            }
        })
    });

    let mut err = Vec::new();
    let _ = stderr.read_to_end(&mut err);
    let out = stdout_thread.join().unwrap_or_default();

    let status = child.wait()?;
    drop(done_tx); // the child is done: wake the killer so it does not fire.
    if let Some(k) = killer {
        let _ = k.join();
    }

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
            timed_out: timed_out.load(Ordering::SeqCst),
            runtime_ms,
        },
        Vec::new(),
    )?;
    Ok(())
}

fn send_exec_err<S: Read + Write>(
    conn: &mut Conn<S>,
    id: u32,
    call: u32,
    code: &str,
    message: &str,
) -> Result<()> {
    conn.send(
        Stream::Exec,
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

fn send_chunks<S: Read + Write>(
    conn: &mut Conn<S>,
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
