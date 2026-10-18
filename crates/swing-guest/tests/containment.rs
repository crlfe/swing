//! Layer-3 tests: containment of the sandbox itself (todo.md T4 / T14).
//!
//! `path_protection.rs` proves the *path policy* holds and that the shell
//! cannot reach a host canary — i.e. the recipe *runs*. These probes go one
//! level deeper: they run commands *inside* the always-sandboxed container and
//! read the kernel's own record of the sandbox (capabilities, namespaces,
//! mounts, network, PID 1), asserting the containment invariants the recipe
//! claims in `sandbox.rs` / `container.rs`.
//!
//! Where a value is host- or bubblewrap-version-dependent the probe prints what
//! it observed rather than assuming it, so a failure is a finding to act on
//! (e.g. add `--cap-drop ALL`), not a flaky test. This is the "confirm, do not
//! assume" discipline todo.md T4 asks for.
//!
//! These need bubblewrap + unprivileged user namespaces (the container is
//! always sandboxed) — see `common`.

mod common;

use std::fs;

use common::Guest;

/// `cat <path>` inside the container; the path must be readable there.
fn read_proc(guest: &mut Guest, path: &str) -> String {
    let (stdout, stderr, code) = guest.exec(&format!("cat {path}"));
    assert_eq!(code, Some(0), "cat {path} failed in container: {stderr}");
    stdout
}

/// A field from `/proc/self/status` (e.g. "NoNewPrivs", "CapEff", "Uid").
fn status_field(status: &str, key: &str) -> String {
    status
        .lines()
        .find_map(|line| {
            let (k, v) = line.split_once(':')?;
            (k.trim() == key).then(|| v.trim().to_string())
        })
        .unwrap_or_else(|| panic!("no {key:?} field in /proc/self/status:\n{status}"))
}

/// Parse `/proc/self/mountinfo` into `(mount point, mount options, fstype)`.
/// The mount point is field 5 and the mount options field 6; the fstype is the
/// first token after the ` - ` separator that ends the optional-fields list.
fn mounts(mountinfo: &str) -> Vec<(String, String, String)> {
    mountinfo
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 6 {
                return None;
            }
            let mount_point = parts[4].to_string();
            let mount_options = parts[5].to_string();
            let sep = parts.iter().position(|&p| p == "-")?;
            let fstype = parts.get(sep + 1)?.to_string();
            Some((mount_point, mount_options, fstype))
        })
        .collect()
}

/// Find one mount by mount point; panic with the full table if absent.
fn find_mount<'a>(
    table: &'a [(String, String, String)],
    point: &str,
) -> &'a (String, String, String) {
    table
        .iter()
        .find(|m| m.0 == point)
        .unwrap_or_else(|| panic!("no mount for {point:?} in mountinfo:\n{table:#?}"))
}

/// `PR_SET_NO_NEW_PRIVS` (set by `harden_payload`) is inherited across execve
/// and cannot be cleared: the payload and everything it runs cannot gain
/// privileges via a setuid binary or similar.
#[test]
fn no_new_privs_is_set() {
    let mut guest = Guest::new();
    let status = read_proc(&mut guest, "/proc/self/status");
    let nnp = status_field(&status, "NoNewPrivs");
    assert_eq!(
        nnp, "1",
        "NoNewPrivs was {nnp:?}, expected 1 (PR_SET_NO_NEW_PRIVS not applied?)"
    );
    guest.assert_canary_intact();
}

/// The payload must hold no effective capabilities. Note this is now guaranteed
/// *twice over*: bubblewrap drops the capability set, and the payload runs as a
/// non-root uid (1000) inside the user namespace, where a non-root process has an
/// empty effective/permitted set regardless. So `CapEff == 0` alone no longer
/// isolates bubblewrap's drop — the uid-independent signal for that is the bounding
/// set (`CapBnd`), surfaced in the failure message so a non-empty one is a finding
/// to act on (e.g. add `--cap-drop ALL` to `bwrap_args`).
#[test]
fn payload_effective_capabilities_are_dropped() {
    let mut guest = Guest::new();
    let status = read_proc(&mut guest, "/proc/self/status");
    let cap_eff = status_field(&status, "CapEff");
    let cap_bnd = status_field(&status, "CapBnd");
    let eff = u64::from_str_radix(&cap_eff, 16)
        .unwrap_or_else(|e| panic!("unparsable CapEff {cap_eff:?}: {e}"));
    assert_eq!(
        eff, 0,
        "CapEff={cap_eff} is a non-empty effective capability set even though the \
         payload runs as non-root uid 1000 (CapBnd={cap_bnd}); something is granting \
         the payload capabilities it should not have."
    );
    guest.assert_canary_intact();
}

/// bubblewrap runs a minimal init as PID 1 of the new PID namespace (it reaps
/// zombies and monitors the app); the payload runs as its child (PID 2). A fresh
/// PID namespace whose process tree is just the sandbox's own init and payload
/// means host processes are not visible in the container's /proc.
///
/// The exact PIDs (1 and 2) and the `comm` strings are bubblewrap's current
/// reaper/payload layout, not a kernel guarantee: a future bubblewrap that inserts
/// a helper could move the payload off PID 2. A failure here is the finding to act
/// on (re-read the layout), not a flaky test — this suite confirms, it does not
/// assume.
#[test]
fn payload_runs_in_its_own_pid_namespace() {
    let mut guest = Guest::new();

    let init = read_proc(&mut guest, "/proc/1/comm");
    assert_eq!(
        init.trim(), "bwrap",
        "PID 1 was {:?}, expected bubblewrap's init (the reaper owning the fresh PID namespace)",
        init.trim()
    );

    let payload = read_proc(&mut guest, "/proc/2/comm");
    assert_eq!(
        payload.trim(), "swing-guest",
        "PID 2 was {:?}, expected the payload (bubblewrap's child)",
        payload.trim()
    );

    guest.assert_canary_intact();
}

/// The recipe pins the in-container identity to a fixed uid/gid 1000
/// (`--uid 1000 --gid 1000` in `sandbox.rs`), so the sandboxed environment is
/// identical regardless of the caller's host uid/gid. Assert that fixed identity
/// is what the payload actually runs as.
#[test]
fn payload_runs_as_fixed_uid_gid() {
    let mut guest = Guest::new();
    let status = read_proc(&mut guest, "/proc/self/status");
    // `Uid:` and `Gid:` are the real/effective/saved/fs quadruples.
    let uid_field = status_field(&status, "Uid");
    let gid_field = status_field(&status, "Gid");
    let uid = uid_field.split_whitespace().next().unwrap_or("");
    let gid = gid_field.split_whitespace().next().unwrap_or("");
    assert_eq!(uid, "1000", "payload uid inside was {uid:?}, expected the fixed 1000");
    assert_eq!(gid, "1000", "payload gid inside was {gid:?}, expected the fixed 1000");
    guest.assert_canary_intact();
}

/// `--unshare-net` gives a fresh network namespace whose only interface is
/// loopback, so the container cannot reach the host network.
#[test]
fn network_namespace_has_only_loopback() {
    let mut guest = Guest::new();
    let netdev = read_proc(&mut guest, "/proc/net/dev");
    let mut ifaces: Vec<String> = Vec::new();
    for line in netdev.lines() {
        // Interface lines are "  name: counters"; the two header lines have no ':'.
        if let Some((name, _)) = line.split_once(':') {
            let name = name.trim().to_string();
            if !name.is_empty() {
                ifaces.push(name);
            }
        }
    }
    let foreign: Vec<&String> = ifaces.iter().filter(|n| *n != "lo").collect();
    assert!(
        foreign.is_empty(),
        "container saw non-loopback interfaces {foreign:?} (expected only 'lo'); raw:\n{netdev}"
    );
    guest.assert_canary_intact();
}

/// The curated root: tmpfs `/`, a read-write `/work`, `proc`, tmpfs `/tmp`, and
/// the payload bound read-only at `/swing-guest`. The host root filesystem is
/// not the container root.
#[test]
fn root_is_tmpfs_with_curated_binds() {
    let mut guest = Guest::new();
    let mountinfo = read_proc(&mut guest, "/proc/self/mountinfo");
    let table = mounts(&mountinfo);

    assert_eq!(find_mount(&table, "/").2, "tmpfs", "container root was not tmpfs");
    let work = find_mount(&table, "/work");
    assert!(
        work.1.split(',').any(|o| o == "rw"),
        "/work was not read-write: mount options {:?}",
        work.1
    );
    assert_eq!(find_mount(&table, "/proc").2, "proc", "/proc was not proc");
    assert_eq!(find_mount(&table, "/tmp").2, "tmpfs", "/tmp was not tmpfs");
    let payload = find_mount(&table, "/swing-guest");
    assert!(
        payload.1.split(',').any(|o| o == "ro"),
        "payload bind /swing-guest was not read-only: mount options {:?}",
        payload.1
    );
    guest.assert_canary_intact();
}

/// Behavioral complement to the mount table: the workspace is writable and the
/// read-only payload bind is not.
#[test]
fn work_is_writable_and_toolchain_bind_is_read_only() {
    let mut guest = Guest::new();

    // /work is read-write.
    let (stdout, stderr, code) = guest.exec("echo probe > /work/probe && cat /work/probe");
    assert_eq!(code, Some(0), "write to /work failed: {stderr}");
    assert_eq!(stdout.trim(), "probe", "read-back of /work/probe: {stdout:?}");

    // The payload bind is read-only: writing to it is refused.
    let (stdout, stderr, code) = guest.exec("echo x > /swing-guest");
    assert_ne!(code, Some(0), "write to read-only /swing-guest was allowed: {stdout:?}");
    assert!(!stderr.is_empty(), "refused write produced no stderr: {stderr:?}");

    guest.assert_canary_intact();
}

/// The design gives the container a tmpfs `/tmp` it can actually use. Now that the
/// payload runs as a non-root uid (1000), confirm `/tmp` is writable *by the payload*
/// and round-trips content — a root-owned tmpfs mountpoint would make the advertised
/// `/tmp` unusable, and no other test writes there.
#[test]
fn tmpfs_tmp_is_writable_by_the_payload() {
    let mut guest = Guest::new();
    let (stdout, stderr, code) = guest.exec("echo tmp-probe > /tmp/probe && cat /tmp/probe");
    assert_eq!(code, Some(0), "write to /tmp failed as uid 1000: {stderr}");
    assert_eq!(stdout.trim(), "tmp-probe", "read-back of /tmp/probe: {stdout:?}");
    guest.assert_canary_intact();
}

/// A file written into `/work` carries the fixed in-container identity *inside*
/// (uid/gid 1000) and maps back to the *host caller* *outside*: the user-namespace
/// map turns the in-container uid 1000 into the uid that spawned the coordinator
/// (this test process). That is what lets the host read the workspace back, and what
/// the per-container distinct uid (D-40) will later key egress on.
///
/// Needs coreutils `stat` in the container (the same package as `cat`, already
/// assumed by `path_protection.rs`).
#[test]
fn work_file_ownership_maps_inside_to_1000_and_outside_to_the_host_caller() {
    use std::os::unix::fs::MetadataExt;

    let mut guest = Guest::new();
    let content = b"ownership probe";
    let (ok, error) = guest.fs_write("owned.txt", content);
    assert!(ok, "write owned.txt -> {error:?}");

    // Inside: the file carries the fixed in-container identity, and the owner can
    // read and write it (the mode's owner rw bits are set whatever the umask).
    let (stdout, stderr, code) = guest.exec("stat -c '%u %g %a' /work/owned.txt");
    assert_eq!(code, Some(0), "stat /work/owned.txt failed: {stderr}");
    let mut fields = stdout.trim().split_whitespace();
    assert_eq!(fields.next(), Some("1000"), "inside uid was not the fixed 1000: {stdout:?}");
    assert_eq!(fields.next(), Some("1000"), "inside gid was not the fixed 1000: {stdout:?}");
    let mode = fields
        .next()
        .and_then(|m| u32::from_str_radix(m, 8).ok())
        .unwrap_or_else(|| panic!("unparsable mode from stat output: {stdout:?}"));
    assert_eq!(
        mode & 0o600,
        0o600,
        "owner read/write bits not set on /work/owned.txt (mode {mode:o})",
    );

    // The protocol read-back agrees with what was written.
    let (ok, error, bytes) = guest.fs_read("owned.txt");
    assert!(ok, "read owned.txt -> {error:?}");
    assert_eq!(bytes, content, "protocol read-back differs");

    // Outside: the same file is owned by the host caller. Compare against the scratch
    // root this test process created directly — the container's uid 1000 maps back to
    // that same host uid, so the two must match.
    let host_file = guest.work.join("owned.txt");
    let host_meta = fs::metadata(&host_file).expect("host-side owned.txt vanished");
    let root_meta = fs::metadata(&guest.root).expect("scratch root metadata");
    assert_eq!(
        host_meta.uid(),
        root_meta.uid(),
        "host-side owner uid {:?} is not the caller's (scratch root uid {:?}) — the \
         in-container uid 1000 did not map back to the host caller",
        host_meta.uid(),
        root_meta.uid(),
    );
    assert_eq!(
        host_meta.gid(),
        root_meta.gid(),
        "host-side owner gid {:?} is not the caller's (scratch root gid {:?})",
        host_meta.gid(),
        root_meta.gid(),
    );
    assert_eq!(
        fs::read(&host_file).expect("read host-side owned.txt"),
        content,
        "host-side bytes differ from what was written",
    );
    // The host caller can read and write it too (the workspace is the host's).
    assert!(
        host_meta.mode() & 0o600 != 0,
        "host-side owned.txt is not owner-readable/writable (mode {:o})",
        host_meta.mode() & 0o777,
    );

    guest.assert_canary_intact();
}
