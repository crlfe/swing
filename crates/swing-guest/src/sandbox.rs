//! Container sandbox via bubblewrap (design.md §11, T4; OQ-7 resolved to
//! bubblewrap). The coordinator runs `bwrap <flags> /swing-guest container
//! --id N`, so the container child runs as **PID 1** inside the bubblewrap
//! sandbox and the host-side `unshare`/`pivot_root`/cap-drop recipe is gone —
//! bubblewrap owns those syscalls. `container.rs` keeps only the two payload-side
//! prctls bubblewrap does not cover (`harden_payload`).
//!
//! The curated bind set is still ours (the design wants a curated root, not the
//! whole host read-only): a tmpfs `/` with read-only toolchain binds, a
//! read-write `/work`, `proc`, tmpfs `/tmp` and a minimal `--dev`. Configure the
//! toolchain set with `SWING_SANDBOX_BINDS` (colon-separated absolute host
//! paths). A source absent on this host is skipped with a note; the payload
//! binary itself is bound in at `/swing-guest` so it is reachable once bubblewrap
//! has replaced the root.
//!
//! Still NOT verified on a real box (T14). cgroup `memory.max`/`pids.max` (§11,
//! D-25) remain the authoritative teardown / fault-isolation backstop and are
//! still a TODO. Future backends (systemd-nspawn / `systemd-run --scope` per
//! OQ-10, nixos-container per B8) replace this module wholesale.

use std::io;
use std::path::Path;

use anyhow::{Context, Result};

// prctl(2) options used by the payload (bubblewrap does not set these).
const PR_SET_NO_NEW_PRIVS: libc::c_int = 38;
const PR_SET_PDEATHSIG: libc::c_int = 1;

/// Path the payload binary is bound to *inside* the sandbox, and the path the
/// payload is exec'd from. A shallow top-level path so its parent (`/`, the
/// tmpfs root) always exists — no deep bind-destination directories to create.
const PAYLOAD_PATH: &str = "/swing-guest";

/// Build the bubblewrap argument vector for one container: every bwrap flag,
/// followed by the payload command (`/swing-guest container --id <id>`). The
/// caller runs `Command::new(bwrap).args(bwrap_args(..))`.
///
/// `exe` is the host `swing-guest` binary; it is bound read-only at
/// `PAYLOAD_PATH` so the payload is reachable after the root is replaced. Its
/// dynamic loader / libc come from the toolchain bind set — for a Nix-built
/// binary the loader lives in the Nix store, which is the open T15/OQ-4 toolchain
/// supply question, not something these default binds cover.
pub fn bwrap_args(work_dir: &str, exe: &Path, id: u32) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    // Namespaces. bubblewrap always unshares mount; --unshare-all adds pid,
    // net, ipc, uts (and, on newer bubblewrap, cgroup — worth remembering when
    // the cgroup limits of D-25 land). The user namespace is required for the
    // uid/gid map, unprivileged operation and --disable-userns, and
    // --unshare-all does not imply it on every supported version, so set it
    // explicitly. With --unshare-pid the payload is PID 1 of the new PID
    // namespace, so the mounted /proc is scoped to it and the whole namespace
    // tears down when it exits.
    args.push("--unshare-user".into());
    args.push("--unshare-all".into());
    // With the user namespace unshared, bubblewrap maps the caller uid/gid to
    // root inside, denies setgroups, and drops the payload's capability set —
    // all defaults, so no flags are needed for them here.
    // Kill the sandbox if the coordinator (bubblewrap's parent) dies.
    args.push("--die-with-parent".into());
    // Defend against the payload escaping via a nested user namespace
    // (bubblewrap >= 0.6).
    args.push("--disable-userns".into());

    // A fresh root: tmpfs, then the curated binds. (Deliberately *not*
    // `--ro-bind / /`: the design wants a curated bind set, not the whole host
    // visible to the container.)
    args.push("--tmpfs".into());
    args.push("/".into());

    // Toolchain bind set (the open T15/OQ-4 question; host dirs as a stopgap).
    // Absent on this host -> skip with a note; present but failing is fatal at
    // spawn time.
    let binds =
        std::env::var("SWING_SANDBOX_BINDS").unwrap_or_else(|_| "/bin:/usr:/lib:/lib64:/etc".into());
    for b in binds.split(':').filter(|s| !s.is_empty()) {
        if !Path::new(b).exists() {
            eprintln!("sandbox: skipping bind {b} (not present on this host)");
            continue;
        }
        args.push("--ro-bind".into());
        args.push(b.to_string());
        args.push(b.to_string());
    }

    // The payload binary must be reachable after the root is replaced.
    args.push("--ro-bind".into());
    args.push(exe.to_string_lossy().into_owned());
    args.push(PAYLOAD_PATH.into());

    // Workspace read-write at /work, plus proc, a minimal /dev and tmpfs /tmp.
    args.push("--bind".into());
    args.push(work_dir.into());
    args.push("/work".into());
    args.push("--proc".into());
    args.push("/proc".into());
    args.push("--dev".into());
    args.push("/dev".into());
    args.push("--tmpfs".into());
    args.push("/tmp".into());

    // Start the payload in the workspace. bubblewrap stops option parsing at the
    // first non-option argument (`/swing-guest`), so the payload's own `--id`
    // reaches it verbatim.
    args.push("--chdir".into());
    args.push("/work".into());
    args.push(PAYLOAD_PATH.into());
    args.push("container".into());
    args.push("--id".into());
    args.push(id.to_string());

    args
}

/// Payload-side hardening bubblewrap does not provide.
///
/// - `PR_SET_NO_NEW_PRIVS`: no privilege escalation via execve (setuid, etc.).
/// - `PR_SET_PDEATHSIG(SIGKILL)`: this process is PID 1 of its PID namespace and
///   its parent is bubblewrap. When the coordinator `kill()`s its `Child`
///   (bubblewrap), the parent-death signal kills this PID 1, and the kernel then
///   tears down the whole PID namespace — reaping the `sh` workload and any
///   orphans. (`--die-with-parent` covers the other direction: the coordinator
///   dying without an explicit kill.) The authoritative backstop for a hung
///   payload is a cgroup kill (§11 / D-25), still a TODO.
pub fn harden_payload() -> Result<()> {
    if unsafe { libc::prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } != 0 {
        return Err(io::Error::last_os_error()).context("PR_SET_NO_NEW_PRIVS");
    }
    if unsafe { libc::prctl(PR_SET_PDEATHSIG, libc::SIGKILL, 0, 0, 0) } != 0 {
        return Err(io::Error::last_os_error()).context("PR_SET_PDEATHSIG");
    }
    Ok(())
}
