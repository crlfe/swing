//! Container role (design.md §5.2): the sandboxed child.
//!
//! bubblewrap has already built the sandbox and made this process **PID 1** of
//! its own PID namespace (see `sandbox.rs`, D-22 / OQ-7). This role only applies
//! the two payload-side prctls bubblewrap does not cover (`harden_payload`), then
//! serves exec/fs frames over its stdin+stdout — the `socketpair` the coordinator
//! handed it, which bubblewrap passes through unchanged. The workspace is the
//! bind-mounted `/work`; the host work directory is only reachable through it.
//!
//! Hardening runs before the first frame is read; if it fails the child dies
//! rather than serving unsandboxed. Once it is serving, a failed call is answered
//! on its own call (`report_if_err`) and the loop keeps serving.

use std::io::{Read, Write};

use anyhow::{Context, Result};
use swing_proto::{Conn, Msg, Stream};

pub fn run(args: &[String]) -> Result<()> {
    let mut id = 0u32;

    let mut i = 0;
    while i < args.len() {
        if args[i].as_str() == "--id" {
            i += 1;
            id = args.get(i).and_then(|s| s.parse().ok()).unwrap_or(0);
        }
        i += 1;
    }

    // bubblewrap has already built the sandbox and made us PID 1 of its PID
    // namespace; the only hardening left is the two prctls bubblewrap does not
    // cover. The workspace is the bind-mounted /work, so `work_root` is fixed.
    crate::sandbox::harden_payload()?;
    // bubblewrap already `--chdir`s here; this guards against a wrong cwd
    // sending `exec` somewhere else.
    std::env::set_current_dir("/work").context("chdir /work")?;
    let work_root = "/work".to_string();

    let mut conn = Conn::new(swing_proto::Duplex::default());
    eprintln!("container {id} serving (work root: {work_root})");

    while let Some(f) = conn.recv()? {
        match f.msg {
            Msg::ExecStart {
                command,
                cwd,
                timeout_ms,
            } => {
                let r = crate::exec::handle_exec(&mut conn, id, f.call, &command, cwd.as_deref(), timeout_ms);
                report_if_err(&mut conn, id, f.call, r)?;
            }
            Msg::ExecCancel => {
                // TODO: cancellation (T3). Not wired in the spike.
            }
            Msg::FsRead { path, offset, limit } => {
                let r = crate::fs::handle_read(&mut conn, id, f.call, &work_root, &path, offset, limit);
                report_if_err(&mut conn, id, f.call, r)?;
            }
            Msg::FsWrite { path } => {
                let r = crate::fs::handle_write(&mut conn, id, f.call, &work_root, &path, &f.body);
                report_if_err(&mut conn, id, f.call, r)?;
            }
            Msg::FsList { path } => {
                let r = crate::fs::handle_list(&mut conn, id, f.call, &work_root, &path);
                report_if_err(&mut conn, id, f.call, r)?;
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

/// A handler failure is a response, not a teardown: report it on the call and
/// keep serving. `relay` treats `error` as terminal for the call, so the server
/// gets an answer instead of an EOF, and the next call reaches the same child.
/// Sent on the control stream even for an exec call; the server matches replies
/// by call id, not by stream. TODO (T3): reply on the call's own stream.
///
/// This is the backstop, not the taxonomy: handlers map their own errno to
/// model-actionable codes (`fs::fs_error_code`), so what reaches here is a
/// handler that did not map. Only a failure to *send* the report is fatal — the
/// channel itself is gone, so `relay` sees the EOF and answers the call
/// `container_died`.
fn report_if_err<S: Read + Write>(
    conn: &mut Conn<S>,
    id: u32,
    call: u32,
    result: Result<()>,
) -> Result<()> {
    let Err(e) = result else {
        return Ok(());
    };
    // The errno goes to the guest log (for whoever is reading it); the model
    // gets the stable code.
    eprintln!("container {id} call {call} failed: {e:#}");
    conn.send(
        Stream::Control,
        id,
        call,
        &Msg::Error {
            code: "call_failed".into(),
            message: format!("{e:#}"),
        },
        Vec::new(),
    )?;
    Ok(())
}
