//! Container sandbox setup (design.md §11, T4). OPT-IN and NOT yet verified on
//! a real box — enable with `SWING_SANDBOX=1` on the coordinator.
//!
//! Recipe (bubblewrap-style, but our own syscalls per D-22):
//!   1. unshare user + mount + pid + net + ipc + uts namespaces.
//!   2. map uid/gid (deny setgroups, map container root -> caller uid).
//!   3. make all mounts private (required before pivot_root).
//!   4. build a tmpfs new root: bind-mount a curated toolchain read-only,
//!      bind-mount the workspace read-write at /work, mount proc + tmpfs /tmp,
//!      bind-mount a minimal /dev.
//!   5. pivot_root into it.
//!   6. PR_SET_NO_NEW_PRIVS + drop the capability bounding set.
//!
//! TODO (needs on-box iteration — T4 / T14 / T15):
//!   - The exact read-only bind set. Toolchain supply is the open T15/OQ-4
//!     question; here we bind-mount host dirs as a stopgap. Configure with
//!     `SWING_SANDBOX_BINDS` (colon-separated absolute paths).
//!   - Clear effective/permitted capabilities via `capset`. Dropping the
//!     bounding set alone is NOT sufficient.
//!   - cgroup `memory.max` / `pids.max` (§11).
//!   - A containment canary test proving nothing escapes (T14).

use std::ffi::CString;
use std::fs::{self, OpenOptions};
use std::io;

use anyhow::{anyhow, Context, Result};

// mount(2) flags (defined locally so we do not depend on libc exposing them).
const MS_RDONLY: libc::c_ulong = 1;
const MS_NOSUID: libc::c_ulong = 2;
const MS_NODEV: libc::c_ulong = 4;
const MS_NOEXEC: libc::c_ulong = 8;
const MS_REMOUNT: libc::c_ulong = 20;
const MS_BIND: libc::c_ulong = 4096;
const MS_REC: libc::c_ulong = 16384;
const MS_PRIVATE: libc::c_ulong = 1 << 18;
const MNT_DETACH: libc::c_int = 2;

// clone(2) namespace flags for unshare(2).
const CLONE_NEWNS: libc::c_int = 0x0002_0000;
const CLONE_NEWUSER: libc::c_int = 0x1000_0000;
const CLONE_NEWIPC: libc::c_int = 0x0800_0000;
const CLONE_NEWUTS: libc::c_int = 0x0400_0000;
const CLONE_NEWPID: libc::c_int = 0x2000_0000;
const CLONE_NEWNET: libc::c_int = 0x4000_0000;

// prctl(2) options.
const PR_SET_NO_NEW_PRIVS: libc::c_int = 38;
const PR_CAPBSET_DROP: libc::c_int = 24;

fn cstr(s: &str) -> Result<CString> {
    CString::new(s).map_err(|e| anyhow!("invalid path {s:?}: {e}"))
}

fn mount(src: &str, dst: &str, fstype: &str, flags: libc::c_ulong, data: Option<&str>) -> Result<()> {
    let c_src = cstr(src)?;
    let c_dst = cstr(dst)?;
    let c_fs = cstr(fstype)?;
    let c_data = match data {
        Some(d) => Some(cstr(d)?),
        None => None,
    };
    let data_ptr: *const libc::c_void = c_data
        .as_ref()
        .map(|c| c.as_ptr() as *const libc::c_void)
        .unwrap_or(std::ptr::null());
    let ret = unsafe { libc::mount(c_src.as_ptr(), c_dst.as_ptr(), c_fs.as_ptr(), flags, data_ptr) };
    if ret != 0 {
        return Err(io::Error::last_os_error())
            .with_context(|| format!("mount {src:?} -> {dst:?} ({fstype})"));
    }
    Ok(())
}

fn bind(src: &str, dst: &str, read_only: bool) -> Result<()> {
    mount(src, dst, "", MS_BIND, None)?;
    if read_only {
        mount(src, dst, "", MS_BIND | MS_REMOUNT | MS_RDONLY, None)?;
    }
    Ok(())
}

pub fn setup(id: u32, work_dir: &str) -> Result<()> {
    let uid = unsafe { libc::getuid() };
    let gid = unsafe { libc::getgid() };

    // 1. Namespaces.
    let ns = CLONE_NEWUSER | CLONE_NEWNS | CLONE_NEWPID | CLONE_NEWNET | CLONE_NEWIPC | CLONE_NEWUTS;
    if unsafe { libc::unshare(ns) } != 0 {
        return Err(io::Error::last_os_error()).context("unshare namespaces");
    }

    // 2. uid/gid map. `deny` setgroups must precede gid_map.
    fs::write("/proc/self/setgroups", b"deny").context("write /proc/self/setgroups")?;
    fs::write("/proc/self/gid_map", format!("0 {gid} 1").as_bytes())
        .with_context(|| format!("write gid_map 0 {gid} 1"))?;
    fs::write("/proc/self/uid_map", format!("0 {uid} 1").as_bytes())
        .with_context(|| format!("write uid_map 0 {uid} 1"))?;

    // 3. Private mounts (required before pivot_root).
    mount("", "/", "", MS_REC | MS_PRIVATE, None).context("make mounts private")?;

    // 4. New root on a tmpfs.
    let newroot = format!("/tmp/swing-root-{id}");
    fs::create_dir_all(&newroot).with_context(|| format!("create {newroot}"))?;
    mount("tmpfs", &newroot, "tmpfs", MS_NOSUID | MS_NODEV, None)
        .with_context(|| format!("mount tmpfs at {newroot}"))?;

    for d in ["dev", "proc", "tmp", "work", "old", "bin", "usr", "lib", "lib64", "etc"] {
        fs::create_dir_all(format!("{newroot}/{d}"))?;
    }

    // Toolchain bind set (stopgap for T15). Configurable.
    let binds =
        std::env::var("SWING_SANDBOX_BINDS").unwrap_or_else(|_| "/bin:/usr:/lib:/lib64:/etc".into());
    for b in binds.split(':').filter(|s| !s.is_empty()) {
        let dst = format!("{newroot}{b}");
        fs::create_dir_all(&dst).ok();
        bind(b, &dst, true).with_context(|| format!("bind toolchain {b} (read-only)"))?;
    }

    // Workspace read-write at /work.
    bind(work_dir, &format!("{newroot}/work"), false).context("bind /work (read-write)")?;

    // proc + tmp.
    mount(
        "proc",
        &format!("{newroot}/proc"),
        "proc",
        MS_NOSUID | MS_NODEV | MS_NOEXEC,
        None,
    )
    .context("mount /proc")?;
    mount("tmpfs", &format!("{newroot}/tmp"), "tmpfs", MS_NOSUID | MS_NODEV, None)
        .context("mount /tmp")?;

    // Minimal /dev by bind-mounting host device nodes onto placeholder files.
    for dev in ["null", "zero", "urandom", "tty"] {
        let dst = format!("{newroot}/dev/{dev}");
        OpenOptions::new()
            .create(true)
            .write(true)
            .open(&dst)
            .with_context(|| format!("create {dst}"))?;
        bind(&format!("/dev/{dev}"), &dst, false).with_context(|| format!("bind /dev/{dev}"))?;
    }

    // 5. pivot_root.
    std::env::set_current_dir(&newroot).with_context(|| format!("chdir {newroot}"))?;
    let ret = unsafe {
        libc::syscall(
            libc::SYS_pivot_root,
            ".".as_ptr() as *const libc::c_char,
            "old".as_ptr() as *const libc::c_char,
        )
    };
    if ret != 0 {
        return Err(io::Error::last_os_error()).context("pivot_root");
    }
    std::env::set_current_dir("/").context("chdir /")?;
    let old = cstr("/old")?;
    unsafe { libc::umount2(old.as_ptr(), MNT_DETACH) };
    fs::remove_dir("/old").ok();

    // 6. no_new_privs + drop the capability bounding set.
    if unsafe { libc::prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } != 0 {
        return Err(io::Error::last_os_error()).context("PR_SET_NO_NEW_PRIVS");
    }
    for cap in 0..=40 {
        // Ignore failures for capabilities absent on this kernel.
        unsafe { libc::prctl(PR_CAPBSET_DROP, cap as libc::c_ulong, 0, 0, 0) };
    }
    // TODO: clear effective/permitted caps via capset; bounding-set drop alone
    // is not sufficient. Needs on-box verification (T14).

    Ok(())
}
