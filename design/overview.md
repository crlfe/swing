# Overview

**Sections:** §1–§4, the §5 component map, §18, §19 · **Read this if:** you want the whole
idea in five minutes. · **Depends on:** nothing — start here. · **Decisions here:** D-1 … D-11
(principles) · **Open:** OQ-1, OQ-4

**Swing** (as in "take a swing at it").

## 1. What this is

Swing is a **sandbox that runs agents**. More precisely, it is currently a slightly
weird mashup between an issue tracker and an agent harness: durable *tickets* that
record a conversation between a developer and a model, plus a hardened execution
environment that the model operates through.

A single distributable artifact starts one long-lived QEMU virtual machine. Each
ticket gets a container inside that VM. **The model runs on the host, in
`swing-server`.** Containers do not run agent software; they are remote-controlled by
model sessions through a tool protocol.

The VM is the security boundary. Its purpose is to protect the developer's machine
from things our agents download, compile, and run — including from a badly configured
host OS and from a malicious or misbehaving model. Containers inside the VM are not
primarily a security feature; they make per-agent environments cheap, reproducible,
and disposable.

## 2. Goals

- **Containment.** Agent-controlled code cannot reach the host filesystem, host
  credentials, or the network. It has no path off the VM.
- **Reproducibility.** A container environment is described by Nix. The same ticket
  resolves to the same store paths.
- **Cheap, disposable containers.** A container is cheap to create and disposable per
  ticket. We do not churn one on every pause — lifetime is tied to the ticket (§5.6) —
  but creating many of them must stay cheap.
- **Auditability.** Everything exchanged with the model is recorded in the ticket.
- **Portability.** Design must work on Linux, macOS, and Windows. First prototype is
  Linux-only; the QEMU invocation and launcher abstractions must stay portable.
- **Minimal dependencies.** One artifact, no host-side installation, no root on the
  host.

## 3. Non-goals (v1)

Quotas, throttling, billing, multi-tenancy, per-container disk images,
process-level checkpoint/restore, network egress policy (there is no network),
macOS and Windows support, VM restart — the VM starts once and stays up; only
containers come and go.

## 4. Core principles

1. **Nothing is mounted, bound, or shared between host and guest.** The host never
   mounts any image. No virtio-fs, no 9p, no shared directories.
2. **The VM has no network device** — not "restricted", but absent, and not compiled
   in. Our QEMU build ships with no network backend at all. Every byte that crosses
   the VM boundary crosses a control-channel chardev. Transfers are server-initiated,
   *except* those through the mediated-egress subsystem ([§10a](networking/egress.md)),
   which is the only guest-initiated path and is deny-by-default.
3. **The model runs on the host.** Model credentials never enter the VM. Model
   reasoning never enters the VM. Only tool calls do.
4. **The tool boundary is the network boundary.** Any tool that touches the network
   is executed by `swing-server`, not in a container. If mediated egress ships, this
   principle is *amended, not dissolved*: containers receive network only through an
   explicit per-container grant, and the grant decision stays in `swing-server`.
5. **The ticket is the durable record and the conversation.** Model text, tool calls,
   tool results, and human comments all live in it.
6. **The Nix store is the only data channel between containers.** Workspaces are
   private to a ticket.

## 5. Components — the map

Detail is in [architecture/components.md](architecture/components.md) (§5.1–§5.3) and
[architecture/tickets.md](architecture/tickets.md) (§5.4–§5.6).

```
HOST                                                   GUEST (the VM)
════                                                   ══════════════

┌───────────────────────────────┐                      ┌─────────────────────────┐
│ swing-server                  │                      │ swing-guest coordinator │
│  - owns tickets (host DB)     │   virtio-serial      │                         │
│  - owns QEMU child            │◄════════════════════►│  - spawns container     │
│  - LLM sessions + provider    │   binary frames      │    children             │
│  - tool dispatch              │   (fd / pipe)        │  - exec/fs primitives   │
│  - scheduler                  │                      │  - workspace mgmt       │
│  - localhost HTTP API+webapp  │                      └───┬─────────┬───────────┘
│  - network tools (fetch, etc) │                          │ spawns  │
└───────────┬───────────────────┘                          ▼         ▼
            │ spawns                                ┌──────────┐ ┌──────────┐
     qemu-system-x86_64                             │container │ │container │
     base.img      (RO)                             │ sandbox  │ │ sandbox  │
     system.qcow2  (RW, persistent)                 │ /work    │ │ /work    │
     scratch.qcow2 (RW, wiped at VM start)          └──────────┘ └──────────┘
                                                    no NIC, no route, caps dropped,
                                                    mount+PID+net+IPC namespaces, cgroup
        ▲
        │ socket / pipe
     swing (CLI, thin client + TUI)
```

## 18. Worked example

`count.yaml`:

```yaml
title: count to ten
goal: Count from 1 to 10 and report the result.
environment: { packages: [] }
```

1. `swing ticket new count.yaml` → ticket `T-42`, status `open`, workspace name
   `tickets/T-42`.
2. Scheduler has a slot → server starts a model session and a container
   (`container.create` → `container.ready`).
3. Server assembles context from the ticket and sends it to the provider.
4. Model emits `tool_call { tool: "shell", args: { command: "seq 1 10" } }`.
5. Server → `exec.start { call: 7 }`; guest streams `exec.output`; guest reports
   `exec.exit { call: 7, code: 0 }`.
6. Server appends `tool_call` and `tool_result` entries to the ticket; TUI shows them
   live.
7. Model emits `report { outcome: "done", summary: "counted 1..10" }`.
8. Server marks `T-42` `done`. The container and workspace are **kept** for the
   ticket's lifetime (until `swing ticket delete` or the VM stops).
9. Developer runs `swing ticket comment T-42 "now do 1..20"` → ticket reopens → new
   attempt reusing the same container and workspace.

## 19. Naming

`swing`, `swing-server`, `swing-guest`, `ticket`, `attempt`, `session`, `container`,
`workspace`, `entry`, `tool call`. Used consistently throughout.

Open subcommand and path names are tracked in [todo/tier4-product.md](../todo/tier4-product.md)
(T29).

---

**Next:** [architecture/components.md](architecture/components.md) for what each binary
is, or [architecture/tickets.md](architecture/tickets.md) for the object model.
