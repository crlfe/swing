# Milestones — two tracks

**Sections:** §17 · **Read this if:** you want the plan and the order things get proven.
· **Depends on:** [../overview.md](../overview.md) · **Decisions here:** D-26, D-36, D-37
· **Open:** OQ-4

Track A answers "is this design good?" Track B answers "is this design buildable?"
They run **in parallel** and neither blocks the other.

## Track A — QEMU-free proof of concept (Linux only)

No QEMU, no Nix, no VM. `swing-server` in the foreground → spawns `swing-guest` →
`swing-guest` spawns container children under bubblewrap around a work directory.
Single Rust program (plus bubblewrap).

**The rule that makes it non-throwaway:** the transport is a byte stream and only
framed messages cross it. Use a **`socketpair()` between `swing-server` and `swing-guest`**
— the Unix form of the real control channel — and never rely on fd inheritance beyond the
connected stream itself, exit codes, signals, or process ownership across the boundary.
Hold that line and swapping the socketpair for a virtio-serial chardev is a configuration
change, not a code change. Use the real binary frame format from day one. The server
spawns `swing-guest` and hands it one end of the socketpair as its stdin/stdout; the guest
binds no path and opens no listener (the listening-socket form belongs only to the
CLI↔server channel, D-46).

Scope: one LLM provider; four tools; tickets as plain JSON files; no DAG, no parking
(until A2), no webapp, no package installation, no baseline Nix environment. The
prototype UI is a **terminal chat** (stdin/stdout of the server) — the TUI and webapp
come later.

Goals: "count to 10", then "write a file, read it back, tell me what changed", then
"here is a repo, find the bug." The highest-value unknown in the project — whether
the tool surface works well against real models — is answered here, cheaply.

## Track B — buildability spikes

1. **Overlay root.** NixOS image whose `/` and `/nix/store` are an overlayfs over a
   read-only base plus a writable second disk. Confirm stage-1 cooperates.
   *Highest-risk spike.*
2. **Boot path and budget.** Direct kernel boot vs. SeaBIOS vs. OVMF. Set numbers.
3. **virtio-serial throughput.** One port or two; max frame size; behavior under a
   large `fs.write` while an `exec` is streaming.
4. **Containment claim.** Run QEMU as an ordinary uid; confirm nothing writes outside
   the three image files. Add `-sandbox on` and re-verify.

## Combined roadmap

| | Milestone |
|---|---|
| A1 | Track A end-to-end: ticket → session → four tools → report. |
| A2 | Parking (container kept alive, waiting for input), human comments, resume reusing the same container. |
| A3 | Ticket DAG: `open_ticket`, blocking, cycle detection, scheduler slots. |
| B1 | Track B spikes complete; a bootable `base.img` from the flake, **with systemd**, meeting the boot-time target. |
| B2 | Swap Track A's socketpair for virtio-serial (fd-passing on Unix, named pipe on Windows) and its bubblewrap sandbox for `base.img` containers. The design is now real. |
| B3 | Transcript/context management: summarization, collapsing, pruning. |
| B4 | Software supply: resolve OQ-4. Explicit, recorded, verified fetch — **not** a tunnel. |
| B5 | Webapp + HTTP API; hardening; macOS/Windows; single-artifact packaging. |
| B6 | **Mediated egress: transparent interception (TPROXY family)** with the §10a constraints — IP/CIDR allowlist, blind DNS forwarding to allowlisted resolvers, per-uid `skuid` policy, deny-by-default, audit into the ticket, dedicated bulk port, L4 relay only. |
| B7 | Image distribution: signed manifest, chunked download with resume, delta updates, verify-then-swap, rollback. |
| B8 | Deferred: VM restart with state, GUI demo transport, nixos-container re-evaluation. |

**Standing constraint:** Track A is a testbed, not a product. The host-side sandbox
(bubblewrap) protects the host's files; it is not a kernel boundary, it requires host
user namespaces, and it does nothing on Windows. The security story is incomplete
until Track B lands.

---

**What is done today** is tracked in [todo/README.md](../../todo/README.md), not here: this
file says what the milestones *are*, the todo says where we actually are. The spikes named
in Track B are [T9 … T14](../../todo/tier2-b1.md).
