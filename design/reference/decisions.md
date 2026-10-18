# Decisions

**Sections:** §20 · **Read this if:** you want the whole decision record, or to check whether
something has already been settled. · **Depends on:** the section each decision belongs to
(see the [section map](../README.md#section-map)) · **Open:** —

Resolved items land here as `D-nn`. IDs are never reused, so a decision stays findable
after it is superseded — a revised decision keeps its number and is marked *(revised)*.

## Recently revised

Recorded here so they are not re-litigated, and so `todo/` does not have to repeat them:

- **Container lifetime tied to ticket status** — created on start, destroyed only on
  delete, parking keeps the container (D-35, revised).
- **Control-channel transport switched from loopback TCP to a private local channel** —
  fd-passing / Unix socket on Unix, DACL-secured named pipe on Windows — for both the QEMU
  and CLI channels, leaving loopback TCP only for the browser HTTP API (D-19, D-27 revised;
  D-44, D-45, D-46).
- **Network backend rejection** (D-28 … D-31).
- **Image size budget** (D-36).
- **Egress mechanism switched from SOCKS5 to transparent interception** (D-32, D-38 … D-40).

## The record

| # | Decision |
|---|---|
| D-1 | Project name: **Swing**. |
| D-2 | QEMU is the security boundary; containers are for reproducibility and fault isolation. |
| D-3 | Exactly one long-lived VM. Containers come and go; the VM does not (v1). |
| D-4 | `swing` and `swing-server` are one host-platform binary with CLI and supervisor modes. |
| D-5 | `swing-guest` is one Linux-amd64 binary: coordinator mode plus bubblewrap-spawned container children. |
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
| D-22 | Prototype containers use **bubblewrap** (`bwrap`), with `swing-guest` as PID 1 inside it. |
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

## Where each decision lives in the design

| Area | Decisions | Section file |
|---|---|---|
| Shape of the system | D-1 … D-11 | [overview.md](../overview.md) |
| Components and objects | D-4, D-5, D-16, D-17, D-21, D-35 | [components.md](../architecture/components.md), [tickets.md](../architecture/tickets.md) |
| Tool surface | D-7, D-9, D-43 | [tool-protocol.md](../interfaces/tool-protocol.md) |
| Wire protocol | D-14, D-15, D-42 | [wire-protocol.md](../interfaces/wire-protocol.md) |
| Channels and process model | D-19, D-27, D-44, D-45, D-46 | [process-model.md](../architecture/process-model.md), [vm.md](../sandbox/vm.md) |
| Environments and storage | D-12, D-13, D-18, D-20, D-36 | [environments.md](../data/environments.md), [storage.md](../data/storage.md) |
| Containers | D-22, D-25, D-40 | [containers.md](../sandbox/containers.md) |
| Networking and egress | D-8, D-28 … D-34, D-38, D-39 | [networking.md](../networking/networking.md), [egress.md](../networking/egress.md) |
| Packaging and distribution | D-23, D-37 | [packaging.md](../data/packaging.md) |
| Provider | D-41 | [todo/tier1-a1.md](../../todo/tier1-a1.md) (T7) |
