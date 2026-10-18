# Tier 2 — blocks B1 (a bootable image)

**Items:** T9 … T14 · **Read this if:** you are doing the Track B buildability spikes.
· **Design sections:** [§9](../design/data/storage.md), [§13](../design/security/security-model.md),
[§14](../design/sandbox/vm.md) · **Open questions:** OQ-8, OQ-9, OQ-10, OQ-22

### T9. Overlay root  *(OQ-8)*
**Highest technical risk in the design.** NixOS stage-1 and its initrd have opinions
about the root filesystem; an overlayfs root spanning a read-only base plus a writable
second disk may fight them.

Decide:
- Does stage-1 support it, or do we need a custom init?
- Confirm the rejection of qcow2 backing files.
- Fallback: writable `base.img`, giving up immutability for v1. Cheaper, but weakens
  "reset is trivial" and "base is hashable" — and it also weakens the delta-update
  story in T30, which depends on an immutable, content-addressed base.

Blocks the shape of `base.img`, so it blocks the flake.

### T10. Boot path and a boot-time budget  *(OQ-9)*
Image size is settled at **under 1 GB** (D-36). Boot time is not.

Decide: direct kernel boot vs. SeaBIOS vs. OVMF, and commit to numbers. Proposals:
**< 5s to `ready`**, **< 250ms container start**.

With systemd now the default, the spike question is "what is the boot time," not "can
we afford systemd."

### T11. Guest init — systemd is the default, verify it  *(OQ-10)*
D-36 removed the size objection. systemd is assumed: supervision, journald, and
`systemd-run --scope` for cgroups for free.

Still to verify:
- Measured boot time against T10's target.
- Whether systemd's scope/transient-unit model actually fits our container lifecycle,
  or fights it.
- What `swing-guest`'s relationship to systemd is: a service unit? Does it use
  `systemd-run` per container, or write cgroupfs itself?
- Only revisit a minimal init if boot time fails the target.

### T12. virtio-serial throughput  *(B1 spike 3)*
Measure: one port or several; behavior under a large `fs.write` while an `exec` is
streaming; head-of-line blocking; whether a dedicated bulk port is needed before
mediated egress (B6) can work at all. This measurement gates B6, not just B2.

### T13. QEMU build and CPU baseline
Decide:
- QEMU version, and **compile in no network backend**: no libslirp, no `virtio-net`,
  no `passt` (D-28). Verify the build actually fails to provide `-netdev user` rather
  than merely not using it — the guarantee should be testable.
- What else we compile out.
- CPU model baseline (`qemu64` vs. x86-64-v2 vs. `-cpu host`) — this constrains the
  flake's `nixpkgs.hostPlatform`, so it must be settled before `base.img` is built.
- Nested-virtualization policy: hard error with a clear message (proposal).

### T13a. Control-channel transport  *(OQ-22)*
The revised transport (D-19, D-27, D-44, D-45) is asserted, not proven. Spike before B2:
- **Unix:** attach a server-created `socketpair` descriptor to QEMU via
  `-chardev socket,fd=N` on Linux **and** macOS — confirm fd numbering, close-on-exec, and
  that the descriptor survives the QEMU `exec`.
- **Windows:** create a named pipe with a DACL admitting only QEMU's restricted token
  (`CreateRestrictedToken`), and attach it to QEMU as a chardev. Determine exactly what the
  restricted token must grant (pipe handle, the three disk files) and what it can drop.
- Confirm the exact QEMU chardev spelling/backend for a Windows named pipe.
- Confirm QEMU ends up with **no socket capability** (ties to T14's containment check and
  D-45).
- Decide one channel vs. two (control + bulk) here, feeding OQ-3.

### T14. Containment verification method  *(B1 spike 4)*
Decide what "prove nothing escapes" means concretely: a strace/auditd sweep, a
read-only host filesystem, a dedicated uid with no readable home directory, a canary
file. Make it repeatable so it becomes a CI test, not a one-off demo. Include a check
that QEMU has no network capability.

---

**Next tier:** [tier3-structural.md](tier3-structural.md). **Previous:**
[tier1-a1.md](tier1-a1.md). These are the spikes listed under Track B in
[design/roadmap/milestones.md](../design/roadmap/milestones.md).
