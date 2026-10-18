# Swing — TODO

Companion to [`design/`](../design/). Ordered by when it blocks us, not by
importance. Two tracks run in parallel: **A** = QEMU-free Linux PoC, **B** =
buildability spikes. Milestones are ordered by dependency, not by a fixed "v1" cut —
where the first product-quality version lands is deliberately left open.

Resolved items are **not** listed here: they live as `D-nn` in
[design/reference/decisions.md](../design/reference/decisions.md), including the
"Recently revised" list (D-19, D-27, D-32, D-35, D-36, D-38 … D-46). Accepted-but-unsolved
risks live in [design/security/accepted-risks.md](../design/security/accepted-risks.md).

## Where to look

| If you want | Read |
|---|---|
| **What to do next** | [first-step.md](first-step.md) |
| **What blocks A1 (the PoC)** | [tier1-a1.md](tier1-a1.md) — T1 … T8b |
| **What blocks B1 (a bootable image)** | [tier2-b1.md](tier2-b1.md) — T9 … T14 |
| **Structural items, decide before they harden** | [tier3-structural.md](tier3-structural.md) — T15 … T22 |
| **Items that shape the product** | [tier4-product.md](tier4-product.md) — T23 … T29 |
| **Image distribution (B7)** | [tier5-distribution.md](tier5-distribution.md) — T30 |
| **Accepted risks, not tasks** | [design/security/accepted-risks.md](../design/security/accepted-risks.md) |

## Traceability — T → OQ → design section

Every open item is an `OQ-nn` in the design and a `T-nn` here. This table is the join.

| T | Item | OQ | Design section |
|---|---|---|---|
| T1 | Tool surface | OQ-1 | [§6](../design/interfaces/tool-protocol.md) |
| T2 | Context assembly | OQ-2 | [§5.4](../design/architecture/tickets.md) |
| T3 | Wire protocol details | OQ-3 | [§7](../design/interfaces/wire-protocol.md) |
| T4 | Container setup, minimal | OQ-7 | [§11](../design/sandbox/containers.md) |
| T5 | Terminal conditions and iteration policy | OQ-5 | [§6](../design/interfaces/tool-protocol.md) |
| T6 | Session/container state machine | OQ-6 | [§5.6](../design/architecture/tickets.md) |
| T7 | Provider integration | — | [§5.1](../design/architecture/components.md) |
| T8 | Ticket file format and comment UX | — | [§5.4](../design/architecture/tickets.md) |
| T8b | Server crash semantics | OQ-15 | [§15](../design/architecture/process-model.md) |
| T9 | Overlay root | OQ-8 | [§9](../design/data/storage.md) |
| T10 | Boot path and boot-time budget | OQ-9 | [§14](../design/sandbox/vm.md) |
| T11 | Guest init — verify systemd | OQ-10 | [§14](../design/sandbox/vm.md) |
| T12 | virtio-serial throughput | B1 spike 3 | [§7](../design/interfaces/wire-protocol.md), [§14](../design/sandbox/vm.md) |
| T13 | QEMU build and CPU baseline | — | [§14](../design/sandbox/vm.md) |
| T13a | Control-channel transport | OQ-22 | [§14](../design/sandbox/vm.md) |
| T14 | Containment verification method | B1 spike 4 | [§13](../design/security/security-model.md), [§14](../design/sandbox/vm.md) |
| T15 | Software supply with no network | OQ-4 | [§8](../design/data/environments.md) |
| T16 | Baseline environment contents | — | [§8](../design/data/environments.md) |
| T17 | Prompt injection and network tools | new | [§13](../design/security/security-model.md) |
| T18 | GUI/demo transport | OQ-11 | [§10](../design/networking/networking.md) |
| T19 | How a developer consumes an output | OQ-12 | [§8](../design/data/environments.md) |
| T20 | Transcript growth and context management | OQ-14 | [§5.4](../design/architecture/tickets.md) |
| T21 | Secrets beyond LLM keys | — | [§13](../design/security/security-model.md) |
| T22 | Scheduler semantics under real tickets | — | [§12](../design/architecture/scheduler.md) |
| T23 | Localhost HTTP API and webapp surface | OQ-13 | [§15](../design/architecture/process-model.md) |
| T23a | CLI↔server transport | OQ-22 | [§15](../design/architecture/process-model.md) |
| T24 | Mediated egress: verify the mechanism | OQ-21 | [§10a](../design/networking/egress.md) |
| T24a | Egress policy model | OQ-17 | [§10a](../design/networking/egress.md) |
| T24b | Allowlist maintenance and DNS-derived grants | OQ-18 | [§10a](../design/networking/egress.md) |
| T24c | L4 relay vs. MITM | OQ-20 | [§10a](../design/networking/egress.md) |
| T25 | Image build pipeline (flake) | — | [§16](../design/data/packaging.md) |
| T26 | Testing strategy | — | [§17](../design/roadmap/milestones.md) |
| T27 | Login-start registration per platform | — | [§15](../design/architecture/process-model.md) |
| T28 | Metering | OQ-16 | [§5.1](../design/architecture/components.md) |
| T29 | Naming leftovers | — | [§19](../design/overview.md) |
| T30 | Update mechanism design | OQ-19 | [§16a](../design/data/packaging.md) |
