# Swing — Design

**Swing** (as in "take a swing at it").

Status: draft v6, pre-prototype. Resolved items are in [Decisions](#20-decisions)
(D-1 … D-46); unresolved items are in [Open Questions](#21-open-questions)
(OQ-1 … OQ-22) and [`todo.md`](todo.md).

---

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
   *except* those through the mediated-egress subsystem ([§10a](#10a-mediated-egress)),
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

## 5. Components

```
HOST                                                   GUEST (the VM)
════                                                   ══════════════

┌───────────────────────────────┐                      ┌─────────────────────────┐
│ swing-server                  │                      │ swing-guest coordinator │
│  - owns tickets (host DB)     │   virtio-serial      │                         │
│  - owns QEMU child            │◄════════════════════►│  - forks container      │
│  - LLM sessions + provider    │   binary frames      │    children             │
│  - tool dispatch              │   (fd / pipe)        │  - exec/fs primitives   │
│  - scheduler                  │                      │  - workspace mgmt       │
│  - localhost HTTP API+webapp  │                      └───┬─────────┬───────────┘
│  - network tools (fetch, etc) │                          │ forks   │
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

### 5.1 `swing` and `swing-server` — one binary, host platform

One executable, two modes:

```
swing                      # attach to server, show TUI
swing up                   # start the server if not running, then attach
swing ticket new count.yaml
swing ticket comment T-42 "try the other approach"
swing ticket delete T-42       # destroy the container and workspace
swing watch T-42
swing trace                # pretty-print control-channel frames
swing down                 # stop the VM and the server
swing status
```

`swing-server` is the long-lived supervisor. It owns the QEMU child, the ticket
database, LLM provider connections, the scheduler, and the control channel to QEMU (an
inherited fd on Unix, a DACL-secured named pipe on Windows). CLI invocations are thin
clients of it over a private local control channel (a Unix socket file on Linux/macOS, a
named pipe on Windows). This is the `docker` / `wsl` shape: the supervisor pattern is the
same on all three host platforms, though the channel object itself is platform-native.

Built for the host platform. Rust.

### 5.2 `swing-guest` — one binary, Linux amd64

One executable with two roles:

- **coordinator** — singleton inside the VM. Speaks the wire protocol to
  `swing-server`. Forks and supervises container children.
- **container** — the forked child, which `unshare`s itself into a sandbox and then
  serves exec/filesystem requests for that container.

Built for Linux amd64 only, always. Ships inside `base.img`.

**Fork safety:** do not `fork()` from an async runtime. The coordinator spawns
`swing-guest container ...` via `std::process::Command` (posix_spawn/vfork) and the
*child* performs its own `unshare`/mount/`pivot_root` before exec'ing anything. The
container child is the security-critical code: keep it small, single-threaded, boring.

### 5.3 The VM

"The VM" means the single long-lived outer QEMU virtual machine. Containers run
inside it. The VM never restarts in v1.

### 5.4 Ticket

The unit of work, the durable record, and the conversation surface between developer
and model. A user or a model session can open one.

```json
{
  "ticket": "T-42",
  "title": "count to ten",
  "goal": "Count from 1 to 10 and report the result.",
  "status": "open | running | blocked | parked | done | failed | deleted",
  "environment": { "packages": ["hello", "ripgrep"] },
  "workspace": "tickets/T-42",
  "blocked_on": ["T-41"],
  "attempts": ["A-101"],
  "entries": [
    { "seq": 1, "kind": "goal",     "from": "user",  "text": "..." },
    { "seq": 2, "kind": "model",    "from": "A-101", "text": "I'll run a shell command." },
    { "seq": 3, "kind": "tool_call","from": "A-101", "tool": "shell", "args": {"command":"seq 1 10"} },
    { "seq": 4, "kind": "tool_result","from":"A-101","call":"c-7","ok":true,"body":"1\n2\n...\n10\n" },
    { "seq": 5, "kind": "comment",  "from": "user",  "text": "good, now do 1..20" },
    { "seq": 6, "kind": "report",   "from": "A-101", "outcome": "done", "text": "counted to 10" }
  ],
  "published": { "result": "/nix/store/xxxx-thing" }
}
```

**Everything exchanged with the model is recorded**: prompts as assembled, model
text, tool calls, tool results. This is deliberately verbose — it is the debugging
tool. Summarization, collapsing, and pruning are a later context-management
milestone, not a reason to record less now.

**Human comments** are first-class entries. A ticket is the initial point of
conversation between developer and model: you can watch it, comment on it, and have
the next attempt see your comment.

`workspace` is a name inside the guest, not a host path.

| Status | Meaning |
|---|---|
| `open` | Unblocked, waiting for a scheduler slot. |
| `running` | Has a live attempt. |
| `blocked` | Waiting on tickets in `blocked_on`. |
| `parked` | Attempt ended deliberately; **container kept alive**, waiting for input. |
| `done` | Session filed a report; container kept until the ticket is deleted. |
| `failed` | Session errored, was cancelled, or hit an iteration limit; container kept until deleted. |
| `deleted` | Ticket deleted; container and workspace removed. |

### 5.5 Attempt, session, container

Three objects, and keeping them distinct matters:

- **Ticket** — durable, host-side, outlives everything.
- **Session** — one model conversation, host-side, in `swing-server`. Owns provider
  state, context assembly, tool dispatch.
- **Container** — one sandbox in the guest, with a workspace mount.

An **attempt** is one model session run against the ticket's container. A ticket
accumulates attempts and **reuses the same container across them**. At most one
attempt per ticket runs at a time.

### 5.6 Two lifetimes

The session is host-side and the container is guest-side, and they can fail
independently. This is a real state machine, not a detail:

| Event | Server action |
|---|---|
| Ticket first starts (first attempt begins) | `container.create` → `container.ready`; the container lives for the ticket's lifetime. |
| Session ends — `report`, iteration limit, or model error | Session ends; **container kept alive** for the ticket. Ticket → `done` or `failed`. |
| Session calls `park` (or model declares it blocked) | Session ends; **container kept alive**; ticket → `parked`, waiting for input. |
| Human comments on a `parked`/`done`/`failed` ticket | Ticket reopens to `open`; a new attempt (when scheduled) **reuses the same container and workspace**. |
| Container dies unexpectedly (OOM, crash) | Attempt fails with `container_lost`; restart the container or fail the attempt (decide: OQ-6). |
| Ticket deleted (`swing ticket delete`) | Container destroyed, workspace removed, uid released. |
| `swing down` | All containers torn down; workspaces lost (v1). |

**Prototype simplification.** Container lifetime is tied to the ticket's status:
created when the ticket first starts, kept across attempts and parking, destroyed only
on `swing ticket delete` (or VM stop). Idle containers are cheap, so we do not tear one
down every time the model pauses for input. *When* a `done`/`failed` container is
reclaimed before deletion is an open item (T6).

## 6. Tool protocol

**`swing-guest` is a remote exec + remote filesystem API.** That framing is the
point: design it as an API with IDs, cancellation, timeouts, streaming, and
truncation — not as a bag of ad-hoc messages.

Two distinct layers, and conflating them is a mistake:

- **Model-facing tool schema** — what the model sees. A server-side concern.
- **Wire primitives** — what `swing-server` and `swing-guest` exchange. A
  guest-side concern.

Draft model-facing surface (v1, four tools):

| Tool | Args | Notes |
|---|---|---|
| `read_file` | `path`, optional `offset`, `limit` | Text; truncated with an explicit marker. |
| `write_file` | `path`, `content` | Creates/overwrites under `/work`. |
| `list_dir` | `path` | Entries + types + sizes. |
| `shell` | `command` (string), optional `cwd`, `timeout` | Runs via a shell (`sh -c`); streams stdout/stderr; returns exit code or signal. |

Later: `edit_file`, `search`, `publish`, `open_ticket`, `park`, `report`.

Terminal tools are explicit: `report {outcome, summary}`, `park {reason}`,
`open_ticket {...}`. Success is not inferred from an exit status any more — the
session must declare it.

Wire primitives (draft):

Server → guest: `container.create`, `container.destroy`, `exec.start`,
`exec.stdin`, `exec.cancel`, `fs.read`, `fs.write`, `fs.list`, `fs.stat`,
`bulk.begin/segment/end`, `shutdown`.

Guest → server: `hello`, `ready`, `container.ready`, `exec.output`, `exec.exit`,
`fs.result`, `log`, `error`.

Properties the protocol must have:

- Every call has a `call_id`; every call is cancellable.
- `exec` output streams incrementally; a running process can be killed.
- Exit is reported as `{code, signal, runtime}` — timeout, signal, and non-zero exit
  are distinguishable.
- Truncation is explicit and visible to the model, never silent.
- Binary-safe: file contents are opaque frame bodies, never escaped strings.

## 7. Wire protocol

**Binary from the start.** Rationale: most payloads are JSON blobs, but file
contents, command output, and later package closures are arbitrary bytes. A binary
frame avoids double-escaping and base64 entirely, and we are writing a pretty-printer
(`swing trace`) either way.

Fixed header + JSON header + opaque body:

| Offset | Field | Size | Notes |
|---|---|---|---|
| 0 | magic | 4 | `SWNG` |
| 4 | version | 1 | currently `1` |
| 5 | kind | 1 | 0 = header only, 1 = header + body |
| 6 | stream | 1 | 0 = control, 1 = exec, 2 = bulk, 3 = log |
| 7 | id | 4 | attempt / container id |
| 11 | call | 4 | call id, 0 if none |
| 15 | seq | 8 | monotonic per (stream, id) |
| 23 | hlen | 2 | header length |
| 25 | blen | 4 | body length |
| 29 | header | hlen | JSON |
| — | body | blen | opaque bytes |

- `stream` lets us split into multiple virtio-serial ports later without changing
  message semantics.
- `call` gives every request/response pair an identity and makes cancellation trivial.
- Max frame size is a protocol constant, not a runtime choice: **4 KiB** (D-42;
  provisional — chosen arbitrarily for the prototype; large payloads are chunked across
  frames on the bulk stream).

**Versioning.** `swing` pins exactly one base image, which contains exactly one
`swing-guest`. The pair is tightly coupled; there is no negotiation and no
compatibility matrix. The header's `version` and a build-id pair exist only so a
mismatch produces a clear error instead of garbage.

Serialization is **serde** (`serde_json` header, body framed with `tokio-util`);
`postcard` is not used (D-42). Document the message set in `schema.toml` so both sides
and the pretty-printer share one definition (still open, OQ-3).

## 8. Environments

**The ticket environment is a NixOS user environment.** The baseline toolset comes
from the base image's system-wide package set (`environment.systemPackages`), which
already provides `sh`, coreutils, and the basics the tool surface needs. A ticket's
`environment.packages` is layered on top as a `pkgs.buildEnv` derivation whose
closure becomes the container's mount plan.

- nixpkgs is pinned inside `base.img` via the flake. No channel fetch at runtime.
- The environment builder resolves the closure (`nix-store --query --requisites`)
  and produces the mount plan. This is where "the ticket describes the environment"
  becomes real.
- Containers get the baseline plus the ticket's closure, read-only. Nothing else.

**Consequence of no network:** new software can only arrive two ways — it was in
`base.img`, or `swing-server` pushed it in over the control channel. There is no
`nix-build` against a binary cache from inside the VM. See OQ-4; this is the largest
open design question.

## 9. Storage

Three image files, owned by `swing-server`, mode 0600, under a per-project state
directory. The host never mounts any of them.

| File | Lifetime | Contents |
|---|---|---|
| `base.img` | Immutable, versioned, built by the flake | Minimal NixOS + `swing-guest` + pinned nixpkgs + baseline packages. Attached read-only. |
| `system.qcow2` | Persistent across server restarts | Writable overlay above the base; `/nix/store` additions; published derivations. |
| `scratch.qcow2` | **Wiped on every VM start** | Container workspaces. Pure scratch. |

`/nix/store` in the guest is an **overlayfs** of the read-only base store (lower) and
a writable upper layer on `system.qcow2`. "Reset the system" = delete the upper
layer. See OQ-8 — the riskiest unvalidated assumption in this document.

**Workspace lifetime.** The server records a workspace name per ticket; the bytes
live on `scratch.qcow2`. A workspace (and its container) lives for the ticket's
lifetime — across attempts and parking — and is removed only when the ticket is
deleted. Because v1 never restarts the VM, this also spans the whole VM session. If
the server shuts the VM down, workspaces are gone and a parked ticket resumes as a
new attempt from its transcript.

## 10. Networking

**There is none in v1.** No `-netdev`, no NIC device, no network configuration in the
guest, no network setup in containers. Our QEMU build compiles in no network backend
(see [§14](#14-qemu-configuration-and-portability)).

- The guest's default namespace has only `lo`.
- Containers still get their own network namespace — not to block external access
  (there is none to block) but to prevent container↔container communication over
  `lo`. Cheap, and it keeps a door closed that we might otherwise open later.
- Every network-touching tool (`web_fetch`, `git_clone`, provider calls) is executed
  by `swing-server` on the host and its results are pushed in as frame bodies.

Consequences to accept:

- **Software supply is now a transfer problem**, not a fetch problem (OQ-4).
- **The GUI/demo milestone is now a bulk-stream problem.** With no NIC there is no
  VNC-over-TCP; display must be transported over the control channel (or a dedicated
  virtio-gpu + bulk stream). This makes the milestone harder and reinforces that it
  is load-bearing, not cosmetic.
- The guest clock cannot be synced from outside. Matters if anything in the guest
  ever needs TLS or timestamps.

This section describes **v1**. Planned mediated egress — which still involves **no NIC
and no QEMU netdev** — is specified in [§10a](#10a-mediated-egress).

## 10a. Mediated egress (planned, not v1)

When containers need to reach the network — because the program under test calls an
API, or because real dev tools must work — the mechanism is **transparent interception
inside the guest using the TPROXY family of kernel mechanisms, tunneled over the serial
link, filtered by `swing-server`.**

Applications are not involved. There is no proxy configuration, no environment
variables, and no cooperation required from the code running in a container.

Rejected alternatives, recorded so they are not re-litigated:

- **QEMU user networking (slirp).** Puts a full userspace TCP/IP stack *inside the
  process that is the security boundary*, requires granting QEMU outbound socket
  syscalls (weakening `-sandbox on`), offers essentially no destination filtering, and
  produces no audit trail. Has a relevant CVE history.
- **passt.** Architecturally attractive — mediation in a separate daemon, real NIC,
  resolver under our control — but **passt's own documentation states it is not
  portable**, and it depends on Linux network namespaces. Since cross-platform support
  is the reason QEMU is in this design at all, passt is out unless that changes.
- **`-netdev dgram` with `local.type=fd|inet`.** Portable, and the `fd` variant gives
  the tightest possible QEMU grant — but it is a **packet pipe, not a byte pipe**. The
  guest kernel would run a full TCP/IP stack talking to *us*, obliging us to write and
  permanently maintain a userspace L2/L3/L4 stack including TCP termination. That is
  "passt's transport without passt's stack": strictly more work than SOCKS and strictly
  worse than passt. virtio-serial already provides the byte stream for free.

- **SOCKS5 over the serial link.** Portable and simple, and it was the initial proposal.
  Superseded: it requires application cooperation (`pip`, `git`, curl, and anything with
  a hardcoded endpoint need the right environment variables or silently bypass), and
  local DNS resolution defeats hostname filtering. Transparent interception keeps every
  advantage SOCKS had — portability, QEMU stays socket-free, no NIC, data path equals
  audit path — and removes both failure modes.

### Mechanism

Textbook TPROXY targets the netfilter `prerouting` chain, which handles *transit*
packets. Our traffic is locally generated inside a guest that has **no NIC**, so the
variant used is policy routing with a `local` route type:

```
ip route add local 0.0.0.0/0 dev lo table <n>
ip rule add fwmark <mark> table <n>
nft add rule ip mangle output ... meta skuid <agent-uid> mark set <mark>
```

A `local` route tells the kernel the destination is local, so the packet is delivered
into the local stack and lands on the `swing-guest` interception socket. The socket is
bound with `IP_TRANSPARENT`, and the original destination address is recovered with
`IP_RECVORIGDSTADDR`. `swing-guest` then asks `swing-server` for a tunnel and relays
bytes.

**This works with only `lo` present.** No NIC, no tap device, no QEMU netdev — so D-28
(no network backend compiled in) survives intact. That is the decisive advantage over
slirp, passt, and `dgram`. To be confirmed by spike; see T24 in `todo.md`.

### Initial egress policy: an IP-address allowlist

Initial policy is deliberately crude and explicit:

- **Deny by default.**
- **Grants are IP addresses and CIDR ranges, not hostnames.**
- **Allowlisted public DNS resolvers are on the list, and DNS requests are forwarded to
  them blindly.** We do not run our own resolver, do not synthesize addresses, and do
  not interpret DNS. Applications resolve normally and get real answers.
- The application's subsequent connection is then allowed or denied by destination IP.

This trades expressiveness for simplicity: no name→IP mapping to maintain, no resolver to
implement, no synthetic address space to leak. Its costs are recorded in OQ-17 and OQ-18.

### The property that makes this safe: it fails closed

With a real NIC, a compromised guest that deletes the firewall rules gains actual network
access. With no NIC, a compromised guest that deletes the rules gains **nothing** — there
is no route, and the only way to regain connectivity is to re-establish the interception
path to `swing-guest`, which is the thing we are trying to prevent.

**The filter's failure mode is disconnection, not bypass.** This comes for free from the
no-NIC decision and is the strongest argument for this design over any NIC-based
alternative.

### Per-container attribution

Marking by socket owner (`nft` `meta skuid`) attributes traffic to the uid that created
the socket. Since each container runs its agent processes under a distinct uid,
**per-container egress policy falls out of the uid assignment.** Grant lifetime maps onto
container lifetime: allocate uid → install rules → destroy container (on ticket delete) →
release uid → remove rules.

Separate network namespaces are still used for isolation; `skuid` matching is what makes
the *policy* per-container rather than per-guest.

### Two problems this must not conflate

- **(a) Dependency and package supply** — `pip`, `npm`, `cargo`, `git clone`. A
  transparent tunnel makes these work but makes them **unverifiable and
  unreproducible**: two runs of the same ticket get different dependency trees, nothing
  is signature-checked, and the Nix store stops being the record of the environment.
  Supply should be an explicit, recorded, verified fetch (OQ-4), not a tunnel.
- **(b) Runtime egress for the program under test.** Here a mediated tunnel is the
  right answer and there is no better alternative.

Keep these as separate features with separate trust models. Conflating them means
dependency supply inherits the runtime egress policy.

### Constraints that make it sound

1. **Policy decisions live in `swing-server`; the guest only installs rules the server
   told it to install.** Keep this line sharp. If grant logic migrates into guest-side
   netfilter configuration, the design has failed.
2. **`swing-guest` needs `CAP_NET_ADMIN` in the guest.** It is already root, so this is
   free — but it is a real capability and it should be scoped to interception setup only.
3. **An allowed IP is a full tunnel.** Interception is L4: once a tunnel is open there is
   no HTTP visibility — no method, path, or content filtering, and no blocking of
   exfiltration to an allowed destination. State this explicitly so nobody believes the
   allowlist is finer-grained than it is.
4. **Deny by default, per-ticket grants, human approval for anything not granted**, with
   a live connections view in the TUI/webapp.
5. **Audit every connection into the ticket** as durable entries — grants, denials, byte
   counts. The data path is the same path we log, so this is structural rather than
   something to remember to implement.
6. **Its own `stream` id and its own virtserialport.** A long-lived tunnel must not
   head-of-line block control or exec traffic.
7. **Denied connections must be surfaced to the model as a denial, not as a socket
   error.** With transparent interception there is no visible proxy for anyone to notice;
   a refused connection looks like the remote host being down. The model needs a way to
   learn it was denied and to request a grant (OQ-17).

### L4 relay vs. MITM — a deliberate fork

TLS is relayed untouched: `swing-guest` forwards bytes, `swing-server` re-originates, and
certificates verify against the real destination. That is the first-release behavior.

Transparent interception makes **MITM** feasible — install our CA in containers, terminate
TLS, and gain L7 filtering on method, path, and content, including the ability to block
exfiltration to an allowed host. That is a genuinely useful capability and a genuinely bad
liability: we would hold a CA able to sign any certificate, in every container, on
**Stay L4 relay in the first egress release**; treat MITM as a decision made
explicitly, never as an implementation convenience (OQ-20).

### Costs, stated honestly

- It amends principle 2: the guest initiates transfers through this subsystem.
- It amends principle 4: containers can have network, subject to policy.
- It enlarges the threat model. Today the risk is "the model is persuaded to call
  `web_fetch`." With mediated egress the risk is "**any code inside a container,
  including a malicious dependency, can open connections subject to an L4 filter.**"
- Per-container setup is heavier than setting environment variables: netns, routing
  table, mangle rules, interception socket.
- An IP allowlist is operationally annoying for CDNs, package registries, and any
  service with rotating addresses (OQ-18).
- DNS-over-HTTPS and other DNS-over-an-allowed-HTTPS-endpoint paths bypass the DNS part
  of the policy entirely (OQ-18).
- Blind DNS forwarding means the guest learns real addresses for hosts we never granted;
  those connections are then denied, which is correct behavior but produces confusing
  failures for the model (OQ-17).
- Throughput is bounded by the link and our framing; a dedicated bulk port is required.
- IPv6 needs a parallel setup.

### Provider-side web search is a separate mechanism

Provider web search (the configured provider's search mechanism, if any — not part of
the Chat Completions spike) runs **entirely on the host**, with no guest involvement, no
egress policy, and no tunnel. "The model looks
something up" and "code in a container opens a socket" are different features and must
not share a design.

## 11. Containers

**Prototype: `unshare` directly, from `swing-guest container`.** bubblewrap is a
candidate but is an extra dependency and hides the syscalls we will need to reason
about anyway. Decide at OQ-7 with measurements.

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
coordinator forks `swing-guest container` children (via `Command` + a `socketpair` as
the child's stdin/stdout) and routes exec/fs frames by container id. The child runs an
opt-in `unshare` recipe (`unshare` user+mount+pid+net+ipc+uts, uid/gid map, private
mounts, tmpfs root with a read-only toolchain bind set + read-write `/work` + `proc` +
tmpfs `/tmp` + minimal `/dev`, `pivot_root`, `PR_SET_NO_NEW_PRIVS` + capability
bounding-set drop) behind `SWING_SANDBOX=1`. It is **not yet verified on-box**; the
effective/permitted capability drop (`capset`), cgroups, the real toolchain bind set
(T15), and a containment canary test (T14) remain open — see `todo.md` T4.

**cgroups.** Not quotas or fairness — fault isolation. One runaway container that
exhausts guest memory otherwise kills every other attempt in the VM.

**Later: evaluate nixos-container.** It bind-mounts the guest's `/nix/store`
read-only per container, which is what we want, and its config is a Nix module per
container. Costs: slower boot and a bridge-centric networking model we do not want.
Re-evaluate at B8.

## 12. Scheduler

Server-side. Deliberately dumb in v1.

- A ticket is **schedulable** if it is `open` and every ticket in `blocked_on` is
  `done`.
- At most N (constant, 2–4) attempts running.
- On attempt completion, re-evaluate and fill slots.
- Cycle detection at ticket creation.
- A failed child leaves its parents blocked; a human decides what happens next. No
  automatic retry in v1.

## 13. Security model

Threat: model-directed code downloading, compiling, and running arbitrary things must
not reach the developer's machine or credentials.

Boundaries, outermost first:

1. **Host → VM.** No shared filesystem, no shared sockets, no host credentials, no
   network device — and no network backend compiled into our QEMU build. QEMU runs
   unprivileged, minimal devices, disks mode 0600.
2. **Guest → host.** Only the control channel. Only framed messages the server
   explicitly understands. The channel is a private object held only by the server and the
   QEMU child — an inherited fd (Unix) or a DACL-secured named pipe (Windows) — so there is
   no listening socket, no port, and no handshake token to steal. (That "no listener" claim
   is specific to the QEMU channel; the host-side CLI channel *is* a listening socket file /
   pipe gated by file permissions or a DACL, and the browser-facing HTTP API is a loopback
   TCP listener — see §15 and OQ-13.) All transfers are
   server-initiated, except through the mediated-egress subsystem, which is
   deny-by-default and fully audited.
3. **Model → host.** The model can only cause tool calls the server recognizes. It
   has no shell on the host, no credentials, and no path to the network except
   through server-implemented tools with server-implemented limits.
4. **Container → guest.** Namespaces, dropped capabilities, read-only store, cgroup
   caps.
5. **Container → container.** None. Separate namespaces; private workspaces; the
   store is read-only.

Supply chain:

- `base.img` built by a **nix flake**, with a pinned nixpkgs revision, to minimize
  supply-chain risk and make the image reproducible.
- Official NixOS signatures trusted; `require-sigs = true`.
- If closures are ever pushed in by the server, *the server* becomes the verifier —
  decide where signature checking happens (OQ-4).

Known weak points, deliberately accepted in v1:

- QEMU is the boundary, so we inherit its device-model CVE history. Mitigated by
  device minimization, absence of any network backend, and Linux `-sandbox on`; not
  solved.
- `swing-server` is now the most powerful component: it holds credentials, has host
  network, and executes network tools on the model's behalf. A prompt-injection
  attack that persuades the model to call `web_fetch` against an attacker endpoint
  is a real, host-side risk. Needs an allowlist story before that tool ships.
- Mediated egress, when it ships, enlarges this further: any code in a container —
  including a malicious dependency — can open connections subject to an L4 filter.
- `swing-guest` runs as root in the guest and is trusted by the server.
- The localhost HTTP API + webapp is the first host-side listener a browser touches and the
  **only** remaining loopback TCP server (the CLI and QEMU channels are private local
  channels). Loopback bind + token auth; decide whether any local process may connect
  (OQ-13).
- Image distribution moves from a bundled artifact to a network download (see
  [§16a](#16a-image-distribution-and-updates)). The download endpoint, the signing
  key, and the delta-application path become as trusted as the flake build.

## 14. QEMU configuration and portability

Portable base — note the absence of any `-netdev`:

```
qemu-system-x86_64 \
  -machine q35 -m 4096 -smp 4 \
  -nodefaults -no-reboot -no-shutdown -display none \
  -rtc base=utc,clock=rt \
  -drive if=none,id=base,file=base.img,read-only=on  -device virtio-blk-pci,drive=base
  -drive if=none,id=sys,file=system.qcow2            -device virtio-blk-pci,drive=sys
  -drive if=none,id=scr,file=scratch.qcow2           -device virtio-blk-pci,drive=scr
  -device virtio-serial-pci \
  -chardev <ctrl-chardev> \
  -chardev <bulk-chardev> \
  -device virtserialport,chardev=ctrl,name=control0 \
  -device virtserialport,chardev=bulk,name=bulk0 \
  -accel <platform> -cpu <platform>
```

No network device at all. No USB, no sound, no VGA, no IDE, no PCI hotplug, no
`-serial`, no `-cdrom`, no `-balloon`.

**The control channel is a private local channel, not a network port.** The server creates
the channel and hands QEMU one end; QEMU never binds a listener and never opens a network
socket. The transport is platform-native because the two native forms give the same
capability-boundary property, and both are strictly stronger than a loopback port:

- **Linux / macOS:** a `socketpair()`; one descriptor is passed to QEMU as
  `-chardev socket,fd=N` (`<ctrl-chardev>` / `<bulk-chardev>` above), the server keeps the
  peer. No port, no listener.
- **Windows:** a named pipe whose DACL grants access only to QEMU's restricted token
  (`CreateRestrictedToken`), handed to QEMU as a named-pipe chardev. The DACL *is* the
  capability boundary.

This replaces the earlier loopback-TCP-everywhere decision (D-19, D-27, now revised): the
Windows named-pipe + DACL + restricted-token mechanism is close enough to Unix fd-passing
that the consistency argument no longer justifies a network port for the QEMU channel. The
channel object — an fd or a pipe handle — *is* the capability, so the QEMU channel needs no
handshake token, binds no port, cannot be reached by any other local process, and produces
no firewall prompt on Windows. The exact chardev spelling per platform is confirmed in the
T13a spike (OQ-22).

**Build guarantee:** our QEMU build compiles in **no network backend** — no libslirp,
no `virtio-net`, no `passt`. "The VM has no network device" is then a build-time
property rather than a config-time one, and a flag typo cannot reintroduce it. If
mediated egress ever needs a backend, that guarantee is walked back deliberately. There is
**no loopback-TCP fallback for the control channel**: if the platform-native channel cannot
be established with the full `-sandbox` / restricted-token grant, Swing fails with a clear
error rather than falling back to a TCP transport that would re-grant QEMU a socket
capability (D-45).

| Option | Linux | macOS | Windows |
|---|---|---|---|
| `-machine q35`, virtio-blk / virtio-serial | ✔ | ✔ | ✔ |
| `-display none`, `-nodefaults`, `-no-reboot`, `-no-shutdown` | ✔ | ✔ | ✔ |
| `-chardev socket,fd=N` (inherited fd) | ✔ — **used** | ✔ — **used** | ✘ — no fd inheritance |
| `-chardev` named pipe (`pipe`) | ✔ | ✔ | ✔ — **used**, DACL-secured |
| `-chardev socket` on 127.0.0.1 | ✔ | ✔ | ✔ — **not used** (old transport) |
| `-chardev socket` AF_UNIX | ✔ | ✔ | ✘ — not used |
| `-netdev user` (slirp) | ✔ | ✔ | ✔ — **not compiled into our build** |
| `-netdev passt` | ✔ | ✘ | ✘ — **not used, not portable** |
| `-netdev dgram` | ✔ | ✔ | ✔ — **not used**, see §10a |
| `-accel kvm` | ✔ | — | — |
| `-accel hvf` | — | ✔ | — |
| `-accel whpx` | — | — | ✔ (needs Windows Hypervisor Platform) |
| `-accel tcg` (fallback) | ✔ | ✔ | ✔ |
| `-cpu host` | ✔ | ✔ | ⚠ with whpx; ✘ with tcg |
| `-sandbox on,...` | ✔ | ✘ | ✘ |

Notes:

- **Acceleration is the portability risk, not the device model.** `whpx` needs the
  Windows Hypervisor Platform; nested virtualization is unavailable on many cloud
  VMs. TCG fallback is correct but 10–50× slower — treat "no hardware acceleration"
  as unsupported with a clear error, not as a slow path.
- On non-`host` CPUs, pin a named model so guest binaries match what `base.img` was
  compiled for. This constrains the flake's `nixpkgs.hostPlatform`.
- `-sandbox on` is Linux-only; no security property in this design may depend on it.
  With no network backend compiled in **and the control channel now an inherited fd rather
  than a TCP connection**, the sandbox grant QEMU needs is essentially file read/write plus
  the two channel descriptors — QEMU is granted **no socket-creation capability** (no
  `socket`/`bind`/`listen`/`connect` syscalls; the channel is a pre-connected fd it only
  reads and writes, which is why the AF_UNIX chardev row above is marked "not used"). On
  Windows the restricted token is scoped the same way: file access plus the named-pipe handle.
- QEMU ships in the artifact bundle per platform, never found on `PATH`.

## 15. Process model and platform integration

The pattern — thin CLI controlling a long-lived per-user supervisor — is idiomatic on
all three platforms, but the *native* long-lived mechanisms differ and we deliberately
use none of them in v1:

| Platform | Native mechanism | Used by Swing? |
|---|---|---|
| Linux | systemd unit / `--user` unit | No (optional generated unit later) |
| macOS | launchd LaunchAgent / LaunchDaemon | No (optional registration later) |
| Windows | Windows Service via the SCM | **No** — needs admin, runs in session 0, cannot show UI |

A Windows service is the wrong shape for "runs as the developer's uid," and session-0
isolation would foreclose the GUI milestone. So: **a detached per-user process with a
pidfile and a private local control channel** (a Unix socket file on Linux/macOS, a named
pipe on Windows). The supervisor pattern needs no install step and works on all three
platforms, though the channel object is platform-native. Precedents: `wsl.exe` + `LxssManager`, Docker Desktop, OrbStack.

Detaching details:

- Unix: `setsid`, ignore SIGHUP.
- Windows: `CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS | CREATE_NO_WINDOW`.
- **Job objects:** if the server puts QEMU in a Windows job object (a common cleanup
  idiom), QEMU dies with the server. Decide deliberately.
- Windows has no SIGHUP and no clean signal; shutdown is a control-channel message.
- IPC: **a private local channel everywhere except the browser surface.**
  - **server ↔ QEMU** — an inherited fd (`socketpair`, Unix) or a DACL-secured named pipe
    (Windows); QEMU is a child we spawn, so we hand it the descriptor / pipe handle.
  - **server ↔ CLI** — a *listening* Unix domain socket (Linux/macOS) or a named pipe whose
    DACL is scoped to the user's SID (Windows); the CLI is an independent process that
    connects later, so the server binds the socket file / creates the pipe. A socket file at
    `0600` or a DACL'd pipe means only this user's processes can connect — no handshake token
    needed on this channel.
  - **HTTP API / webapp** — **loopback TCP**, the *only* place a TCP server is used, because
    a browser cannot open a Unix socket or a named pipe. Token auth (OQ-13) stays here.

  Track A's server ↔ `swing-guest` link mirrors the Unix fd form (a `socketpair`) so the B2
  swap to virtio-serial stays a config change.
- Login-start registration (systemd user unit / LaunchAgent / Task Scheduler) is
  deferred to B5, but the server's design must tolerate being started by something
  other than the CLI.

## 16. Packaging and image build

- **`base.img` is built by a nix flake** — pinned nixpkgs, reproducible, hashed,
  versioned. The flake is the supply-chain control point.
- Prototype distribution: one `tar.zst` containing the `swing` binary, the QEMU
  binaries, and the three disk images. No installer, no self-extraction. **This is a
  prototype convenience, not the shipping plan** — see §16a.
- Later: a single self-contained statically-linked binary — Rust with
  `x86_64-unknown-linux-musl` for Linux. "Self-contained" is a packaging problem, not
  a language problem — QEMU is a subprocess. **The base image is not embedded in the
  binary**; it is fetched separately (see §16a). Embedding a ~1 GB image would just be
  shipping a large archive, which §16a is designed to avoid.

## 16a. Image distribution and updates

Pre-ship goal: **the daemon downloads the base image**, with resume and binary-diff
updates, rather than shipping a large archive for users to download — and it
periodically re-fetches so the guest picks up security fixes. The early prototype
skips this and ships a single `tar.zst` bundle (see §16).

Shape:

- **Signed manifest** pins the exact image hash and the `swing` ↔ `base.img` ↔
  `swing-guest` triple. This is what makes D-15 ("no protocol negotiation") workable
  over a network: the manifest *is* the pin.
- **Content-defined chunking** for deltas — the `casync` family, or `xdelta3` /
  bsdiff against the previous image. CDC is preferred for disk images: it dedupes
  across versions, tolerates byte reordering, and does not degrade when a rebuild
  shifts bytes early in the file the way plain bdiff does.
- **Resume at chunk granularity**, via HTTP range requests against a chunk store, not
  against one large blob. Resume is far more robust when the unit is a chunk.
- **Verify-then-swap:** fetch chunks → assemble → verify against the manifest → atomic
  rename → retain the previous image for rollback.
- **Cache keyed by content hash**, so versions share chunks and a state directory does
  not grow linearly.
- The read-only, immutable `base.img` is unusually well suited to this: it is
  content-addressed, so cross-version dedupe is natural.

Two things to treat as first-class:

1. **This is a supply-chain surface, and it is the one that matters most.** The
   download endpoint, the signing key, and the delta-application path become as
   trusted as the flake build. A compromised delta compromises the VM image for every
   user. It gets its own section in the security review, not a line under packaging.
2. **Offline becomes a mode to design for.** First run now requires host network. A
   bundled fallback image, or a "copy the cache directory" path, should be stated even
   if it is low priority.

## 16b. Image size budget

**Under 1 GB is acceptable.** That settles the size half of a three-way coupling
(image size / guest init / baseline packages) and makes **keeping systemd in the guest
the default** rather than the expensive option — which buys supervision, journald, and
`systemd-run --scope` for cgroups, i.e. real code we do not have to write.

Size and boot **time** are separate budgets. systemd costs time, not only bytes, so
the open question is now "what is the boot time," not "can we afford systemd." See
OQ-9 and OQ-10.

## 17. Milestones — two tracks

Track A answers "is this design good?" Track B answers "is this design buildable?"
They run **in parallel** and neither blocks the other.

### Track A — QEMU-free proof of concept (Linux only)

No QEMU, no Nix, no VM. `swing-server` in the foreground → forks `swing-guest` →
`swing-guest` forks container children that `unshare` themselves around a work
directory. Single Rust program.

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

### Track B — buildability spikes

1. **Overlay root.** NixOS image whose `/` and `/nix/store` are an overlayfs over a
   read-only base plus a writable second disk. Confirm stage-1 cooperates.
   *Highest-risk spike.*
2. **Boot path and budget.** Direct kernel boot vs. SeaBIOS vs. OVMF. Set numbers.
3. **virtio-serial throughput.** One port or two; max frame size; behavior under a
   large `fs.write` while an `exec` is streaming.
4. **Containment claim.** Run QEMU as an ordinary uid; confirm nothing writes outside
   the three image files. Add `-sandbox on` and re-verify.

### Combined roadmap

| | Milestone |
|---|---|
| A1 | Track A end-to-end: ticket → session → four tools → report. |
| A2 | Parking (container kept alive, waiting for input), human comments, resume reusing the same container. |
| A3 | Ticket DAG: `open_ticket`, blocking, cycle detection, scheduler slots. |
| B1 | Track B spikes complete; a bootable `base.img` from the flake, **with systemd**, meeting the boot-time target. |
| B2 | Swap Track A's socketpair for virtio-serial (fd-passing on Unix, named pipe on Windows) and its `unshare` for `base.img` containers. The design is now real. |
| B3 | Transcript/context management: summarization, collapsing, pruning. |
| B4 | Software supply: resolve OQ-4. Explicit, recorded, verified fetch — **not** a tunnel. |
| B5 | Webapp + HTTP API; hardening; macOS/Windows; single-artifact packaging. |
| B6 | **Mediated egress: transparent interception (TPROXY family)** with the §10a constraints — IP/CIDR allowlist, blind DNS forwarding to allowlisted resolvers, per-uid `skuid` policy, deny-by-default, audit into the ticket, dedicated bulk port, L4 relay only. |
| B7 | Image distribution: signed manifest, chunked download with resume, delta updates, verify-then-swap, rollback. |
| B8 | Deferred: VM restart with state, GUI demo transport, nixos-container re-evaluation. |

**Standing constraint:** Track A is a testbed, not a product. `unshare` protects the
host's files; it is not a kernel boundary, it requires host user namespaces, and it
does nothing on Windows. The security story is incomplete until Track B lands.

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

## 20. Decisions

| # | Decision |
|---|---|
| D-1 | Project name: **Swing**. |
| D-2 | QEMU is the security boundary; containers are for reproducibility and fault isolation. |
| D-3 | Exactly one long-lived VM. Containers come and go; the VM does not (v1). |
| D-4 | `swing` and `swing-server` are one host-platform binary with CLI and supervisor modes. |
| D-5 | `swing-guest` is one Linux-amd64 binary: coordinator mode plus forked container children. |
| D-6 | **The model runs in `swing-server`.** No agent executable in containers, no third-party agent software. |
| D-7 | Containers are remote-controlled via a tool protocol: remote exec + remote filesystem. |
| D-8 | No network device in the VM; no network setup in containers. |
| D-9 | The tool boundary is the network boundary: network tools run on the host. |
| D-10 | Everything exchanged with the model is recorded in the ticket. Pruning is deferred. |
| D-11 | Human comments are first-class ticket entries; the ticket is the developer↔model conversation. |
| D-12 | Baseline container toolset comes from the base image's system-wide NixOS package set; ticket packages layer on top. |
| D-13 | `base.img` is built by a nix flake with pinned nixpkgs. |
| D-14 | Wire protocol is binary frames with JSON headers and opaque bodies, from the start. |
| D-15 | `swing` pins exactly one base image containing exactly one `swing-guest`; no protocol negotiation. |
| D-16 | Server owns tickets; guest owns containers. No dual source of truth. |
| D-17 | Server records only the *name* of a ticket's workspace; it does not back up workspace contents. |
| D-18 | Host never mounts images; nothing bound or shared host↔guest. |
| D-19 | Control channel is virtio-serial over a **private local chardev** — an inherited fd (Unix) or a DACL-secured named pipe (Windows) — created by the server and handed to QEMU; QEMU never listens and never opens a network socket. *(revised)* |
| D-20 | Environment changes restart the container; running containers are never mutated. |
| D-21 | Server owns all credentials; nothing model-related enters the VM. |
| D-22 | Prototype containers use `unshare` directly from `swing-guest`. |
| D-23 | Prototype packaging is a `tar.zst` bundle — a prototype convenience, not the shipping plan. |
| D-24 | Prototype is Linux-only; QEMU invocation and abstractions stay portable. |
| D-25 | cgroup `memory.max` / `pids.max` as fault isolation, not fairness. |
| D-26 | Two parallel tracks: QEMU-free PoC (A) and buildability spikes (B). |
| D-27 | **Server↔QEMU and server↔CLI are platform-native local channels** (fd-passing / Unix socket on Unix, named pipe on Windows), not loopback ports. **Loopback TCP is reserved for the browser-facing HTTP API/webapp only**; Track A mirrors the Unix fd form (a `socketpair`). *(revised)* |
| D-28 | Our QEMU build compiles in **no network backend**: no libslirp, no `virtio-net`, no `passt`. |
| D-29 | QEMU user networking (slirp) is rejected: stack inside the boundary process, requires socket grants, no filtering, no audit. |
| D-30 | passt is rejected: its own documentation states it is not portable, and portability is the reason QEMU is in this design. |
| D-31 | `-netdev dgram` is rejected: it is a packet pipe, obliging us to write and maintain a userspace L2/L3/L4 stack. virtio-serial already gives a byte pipe. |
| D-32 | Mediated egress, when it ships, is **transparent interception in the guest using the TPROXY family** (policy routing + `local` route type + `IP_TRANSPARENT` + `IP_RECVORIGDSTADDR`), tunneled over the serial link, filtered by `swing-server`. SOCKS5 is superseded. |
| D-33 | Dependency supply and runtime egress are **separate features** with separate trust models. Supply is an explicit verified fetch, never a tunnel. |
| D-34 | Provider-side web search is a host-only mechanism, separate from the egress subsystem. |
| D-35 | **Container lifetime is tied to the ticket's status**: the container is created when the ticket first starts and is kept across attempts and parking; it is destroyed only when the ticket is deleted (or the VM stops). Parking keeps the container alive. |
| D-36 | `base.img` budget is **under 1 GB**, which makes **systemd in the guest the default**. Boot *time* remains an open target. |
| D-37 | Pre-ship image distribution is a **signed manifest + chunked download with resume + delta updates + verify-then-swap + rollback**. |
| D-38 | Initial egress policy is a **deny-by-default allowlist of IP addresses and CIDR ranges**. Allowlisted public DNS resolvers are included and **DNS requests are forwarded to them blindly** — no custom resolver, no synthetic addresses, no DNS interpretation. |
| D-39 | Egress is an **L4 relay in the first egress release**: TLS passes through untouched and certificates verify against the real destination. MITM is a separate, explicit decision (OQ-20). |
| D-40 | Per-container egress policy is keyed to the **container's uid** via `nft` `meta skuid` marking; grant lifetime follows container lifetime. |
| D-41 | Provider is **OpenAI-compatible Chat Completions**, configured via `OPENAI_BASE_URL` / `OPENAI_MODEL` / `OPENAI_API_KEY`. The provider is a swappable server-side detail. |
| D-42 | Wire header serialization is **serde** (`serde_json`), not `postcard`. Max frame size is **4 KiB** — a provisional prototype constant; large payloads are chunked across frames on the bulk stream. |
| D-43 | The `shell` tool takes a **`command` string** (run via `sh -c`), not `argv`, in v1. |
| D-44 | On Windows the QEMU channel is a **named pipe secured by a DACL** granting access only to QEMU's **restricted token** (`CreateRestrictedToken`); the DACL is the capability boundary, replacing the handshake token. |
| D-45 | QEMU is granted **no socket capability**: the control channel is an inherited fd or a pipe handle, so the `-sandbox` / restricted-token grant is file I/O plus the channel handles only. Reinforces D-28. |
| D-46 | The **CLI↔server** channel is a private local channel — a listening Unix domain socket (Linux/macOS) or a named pipe with a DACL scoped to the user's SID (Windows). The OS object (socket-file perms / pipe DACL) is the capability boundary, so this channel needs no handshake token. The TCP server exists only for the browser-facing HTTP API/webapp. |

## 21. Open questions

### OQ-1 — Tool surface design

The single most important open item. Tool schemas, naming, truncation semantics,
error shapes the model can act on, how the model learns the workspace layout, and how
many tools is too many. Track A exists largely to answer this.

### OQ-2 — Context assembly

How ticket entries become model context. Full transcript every turn? Windowing?
Summarize old entries? How are human comments injected? How are tool results from
earlier turns represented? Deferred to B3 for *management*, but a naive rule is
needed for A1.

### OQ-3 — Wire protocol details

Resolved: header serialization is **serde** (`serde_json`), max frame size is **4 KiB**
(provisional) — see D-42. Still open: backpressure when the channel fills, whether one
or two virtserialports, and whether the message set is defined in `schema.toml`.

### OQ-4 — Software supply with no network  *(largest structural question)*

With no NIC in the VM, new software arrives only from `base.img` or via
server-pushed transfer. Options:
- (a) Everything from `base.img`; "request additional software" is deferred.
- (b) Server implements enough of the Nix HTTP binary-cache protocol to fetch
  `.narinfo`/`.nar`, verify signatures, and stream closures into the guest store.
- (c) Guest store is fixed; tickets choose only from what is present.

(b) is the most capable and puts signature verification on the host. Needs a decision
before B4.

### OQ-5 — Terminal conditions and iteration policy

What ends a session: explicit `report`/`park`, max iterations, provider error, no
tool call requested, model declaring failure. And what each looks like in the ticket.

### OQ-6 — Container loss

If a container dies mid-session, does the server restart it and continue the same
session, or fail the attempt? Continuing is nicer and harder (the model's assumed
state may no longer be true).

### OQ-7 — `unshare` directly vs. bubblewrap vs. nixos-container

Decide with measurements from A1 and B1.

### OQ-8 — Overlay root

Guest-side overlayfs vs. qcow2 backing files. Recommendation: overlayfs — but NixOS
stage-1 and its initrd have opinions about the root filesystem, and an overlay root
spanning two virtio disks may fight them. Spike B1.

### OQ-9 — Boot path and boot-time budget

Direct kernel boot vs. SeaBIOS vs. OVMF. Image size is settled (under 1 GB, D-36);
**boot time is not**. Proposals to test against: **< 5s VM boot to `ready`**,
**< 250ms container start**. With systemd now the default (D-36), the spike question
is "what is the boot time," not "can we afford systemd."

### OQ-10 — Guest init: systemd is now the default

D-36 removed the size objection, so systemd is assumed: supervision, journald, and
`systemd-run --scope` for cgroups for free. Remaining open items: measured boot time,
whether `systemd-nspawn`-style scope management is actually usable for our container
model, and whether a minimal init is worth revisiting *only* if boot time fails the
target.

### OQ-11 — GUI/demo transport, now that there is no NIC

No VNC-over-TCP. Options: virtio-gpu + screenshots over the bulk stream; a Wayland
socket proxied over virtio-serial; SPICE over a chardev. Removing the NIC made this
strictly harder. Also: the GUI milestone introduces a **human → model/container input
channel**, a new trust boundary.

### OQ-12 — How does a developer consume a published output?

The host has no Nix and the VM has no network. "Publish a nix package" is well-defined
inside the VM; delivery to a plain Windows or macOS machine is unresolved. Options:
run it in the VM and expose the result (ties to OQ-11); export a portable bundle;
export the closure for archival only. Needs an answer before B4.

### OQ-13 — Localhost HTTP API and webapp surface

After D-27/D-46 the CLI and QEMU channels are private local channels, so **this is the only
remaining loopback TCP server** — and the only surface where a token is the capability
boundary (a browser cannot use a Unix socket or a named pipe, so it must have a port).
Loopback bind + token auth is assumed. Decide: who may connect, how the token is
distributed, whether the webapp is the primary UI or the TUI is, and what the API
exposes. This is the first host-side listener a browser touches.

### OQ-14 — Transcript growth

Recording everything means tickets can reach hundreds of megabytes with large tool
results. Entry size caps, external blob storage, and the point at which the ticket
stops being a readable document.

### OQ-15 — Server crash semantics

Pidfile/lock format, adopt-or-kill rule for an orphaned QEMU child, what `swing up`
reconstructs, and whether in-flight sessions can be resumed or are simply failed.

### OQ-16 — Metering

We are not throttling, but the server is spending real money on provider calls.
Record tokens and cost per ticket/attempt? Probably yes, cheaply, from day one.

### OQ-17 — Egress grant model

D-38 fixes v1 as a deny-by-default IP/CIDR allowlist. Still open:

- **Grant lifetime.** Permanent per ticket? Per attempt? Time-boxed? Tied to a human
  approval that expires?
- **Who can grant one.** Human approval only, model request with approval, or
  pre-declared in the ticket's environment block.
- **How a denial is surfaced to the model.** With transparent interception there is no
  visible proxy; a denied connection looks like the remote host being down. The model
  needs to learn "you were denied, here is the destination, ask for a grant" rather than
  debug socket errors. This is the main usability risk of the transparent design.
- **Byte accounting and rate limits per grant.**
- **Port granularity.** Is a grant an IP alone, or IP + port range? An allowlisted IP
  with all ports open is a very wide door.

### OQ-18 — IP allowlist maintenance

D-38's simplicity has a running cost, and it is the item most likely to force a design
change:

- **CDNs and package registries have rotating addresses.** GitHub, S3, PyPI, npm, and
  most object storage do not have stable IPs. An IP allowlist will either be huge,
  stale, or constantly maintained.
- **Blind DNS forwarding means the guest learns real addresses for hosts we never
  granted**, and those connections are then denied. Correct, but it produces a lot of
  confusing failures.
- **DNS-over-HTTPS bypasses the DNS part of the policy entirely.** Any allowed HTTPS
  endpoint can become a resolver. Decide whether DoH endpoints are blocked by default.
- **The natural evolution is DNS-derived grants:** since DNS responses transit our
  interception path, we can observe which addresses a permitted name resolved to and
  grant those addresses briefly. This keeps the IP-allowlist mechanism while recovering
  name-based policy. Worth prototyping early, because if it works it removes most of
  this problem — and if it does not, the allowlist becomes an operational burden.
- **Name-based policy is what users will expect.** Decide when we cross from "IP
  allowlist, honestly labeled" to "hostname allowlist implemented via DNS observation."

### OQ-19 — Update endpoint and key management

Where images and chunks are hosted; who holds the signing key and how it is rotated;
what a client does on signature failure; how a bad release is revoked; and what the
bundled offline fallback is. Treat as a security review item, not a packaging detail.

### OQ-20 — L4 relay vs. MITM

D-39 fixes L4 relay for v1. MITM (our CA in every container, TLS terminated) would
enable method/path/content filtering and exfiltration blocking, at the cost of holding a
CA able to sign any certificate on developer machines. Decide explicitly if and when;
never let it be decided by implementation convenience. Related sub-questions: where the
CA lives, whether it is per-installation or shared, and how a container is told to trust
it.

### OQ-21 — TPROXY mechanism verification

The mechanism in §10a is asserted, not yet proven. Confirm by spike:

- Does `ip route add local 0.0.0.0/0 dev lo` plus `ip rule add fwmark` deliver
  **locally generated** traffic to a local socket in a namespace with only `lo`, with no
  NIC present at all?
- Is the marking hook the right one for locally generated packets (`nft` mangle/`output`
  chain with `meta skuid`), given that the TPROXY target itself is `prerouting`-only?
- Does `IP_TRANSPARENT` + `IP_RECVORIGDSTADDR` behave as expected for accepted sockets,
  and what do applications observe from `getpeername()`?
- Source-address selection for intercepted sockets, IPv6 parity, and UDP/53 handling.
- Whether any of this behaves differently under a systemd-managed guest (D-36), which may
  want to own networking configuration.
- **How per-container network namespaces (§11) coexist with the interception path.**
  Containers are isolated in their own netns to block container↔container backchannels,
  but the interception socket and the `skuid` marking rules live in the guest. How the
  routing table and firewall config are installed per-netns — and how intercepted bytes
  reach `swing-server` from a netns that has only `lo` — is unresolved and is the central
  thing the spike must answer.

### OQ-22 — Control-channel transport verification

The revised transport (D-19, D-27, D-44, D-45) is asserted, not yet proven. Confirm by
spike (T13a):

- Does `-chardev socket,fd=N` reliably attach a server-created `socketpair` descriptor on
  both Linux and macOS, including across the QEMU `exec` boundary (fd numbering,
  close-on-exec, descriptor survival)?
- On Windows: can a named pipe be created with a DACL that admits **only** the QEMU child's
  restricted token, and can QEMU attach it as a chardev? What exactly must
  `CreateRestrictedToken` grant (the pipe handle, the three disk files) and what can it
  drop?
- The exact QEMU chardev spelling/backend for a Windows named pipe.
- Whether control + bulk are two fds/pipes or one multiplexed channel (ties to OQ-3).
- Confirm QEMU ends up with **no socket capability** (ties to T14's containment check and
  D-45).
- **CLI↔server channel (D-46):** confirm a listening Unix domain socket works on Linux and
  macOS — mind the `sockaddr_un` path-length limit (~104 chars on macOS), so pick a short
  socket path — and that a Windows named pipe can be created with a DACL scoped to the
  user's SID. Confirm the socket-file / pipe lifecycle on server crash (ties to OQ-15).
