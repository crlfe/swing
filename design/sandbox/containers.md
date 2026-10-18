# Containers

**Sections:** §11 · **Read this if:** you want to know exactly what a container is given and
what it is denied. · **Depends on:** [../architecture/components.md](../architecture/components.md)
(§5.2), [../data/environments.md](../data/environments.md) (§8, the mount plan)
· **Decisions here:** D-5, D-20, D-22, D-25, D-35, D-40 · **Open:** OQ-7

**Prototype: bubblewrap (`bwrap`), with `swing-guest container` as PID 1 inside
it.** The hand-rolled `unshare` recipe was getting hard to audit, so we delegate the
namespaces/mount/pivot/cap syscalls to bubblewrap (D-22, OQ-7). The curated bind set
(tmpfs root, read-only toolchain, read-write `/work`, `proc`, tmpfs `/tmp`, minimal
`/dev`) is still ours, expressed as bubblewrap flags.

What a container gets:

- New mount, PID, network, IPC, and (if used) user namespaces.
- `/nix/store` read-only, limited to the closure of the ticket environment plus the
  baseline.
- Ticket workspace read-write at a fixed path (`/work`). tmpfs `/tmp`. Nothing else.
- Dropped capabilities, no setuid, device nodes limited to `/dev/null`, `/dev/zero`,
  `/dev/urandom`, `/dev/tty`.
- A cgroup with `memory.max` and `pids.max`.
- **A distinct uid**, allocated for the container's lifetime. This is what egress policy
  keys on (`nft` `meta skuid`, D-40) even before egress ships, so the mechanism is
  exercised early.

**Spike status (Track A).** The coordinator/container split is implemented: the
coordinator spawns `bwrap … swing-guest container` children (via `Command` + a
`socketpair` as the child's stdin/stdout) and routes exec/fs frames by container id.
bubblewrap builds the sandbox (`--unshare-user --unshare-all`, uid/gid map,
`--disable-userns`, `--die-with-parent`, its default capability drop, a tmpfs root
with a read-only toolchain bind set + read-write `/work` + `proc` + tmpfs `/tmp` +
`--dev`) and runs the child as **PID 1** of its own PID namespace before it reads
its first frame; there is no switch
to turn it off, and a child whose sandbox fails to set up dies rather than serving
unsandboxed. The child keeps only the two prctls bubblewrap does not cover
(`PR_SET_NO_NEW_PRIVS`, `PR_SET_PDEATHSIG`). It is **not yet verified to contain**;
cgroups, the real toolchain bind set (T15), and a containment canary test (T14) remain
open — see [todo/tier1-a1.md](../../todo/tier1-a1.md) T4.

**cgroups.** Not quotas or fairness — fault isolation. One runaway container that
exhausts guest memory otherwise kills every other attempt in the VM.

**Later: evaluate nixos-container.** It bind-mounts the guest's `/nix/store`
read-only per container, which is what we want, and its config is a Nix module per
container. Costs: slower boot and a bridge-centric networking model we do not want.
Re-evaluate at B8.

---

**Related:** the uid is the hook that per-container egress policy hangs on
([../networking/egress.md](../networking/egress.md), D-40) · containment is verified by
[T14](../../todo/tier2-b1.md) · the sandbox itself is [T4](../../todo/tier1-a1.md) ·
implemented in `crates/swing-guest/src/sandbox.rs`.
