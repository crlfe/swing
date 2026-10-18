# Open questions

**Sections:** §21 · **Read this if:** you want to know what is genuinely undecided, and which
one to answer next. · **Depends on:** the section each question belongs to (see the
[section map](../README.md#section-map)) · **Decisions here:** —

Unresolved items are `OQ-nn`. When one is settled it becomes a `D-nn` in
[decisions.md](decisions.md) and the work moves to [`todo/`](../../todo/). Some entries are
partially resolved; the resolved half is stated so it is not re-opened.

## Register

| ID | Question | Area | Status | Answer needed by | Work item |
|---|---|---|---|---|---|
| OQ-1 | Tool surface design | [§6](../interfaces/tool-protocol.md) | **open — most important** | A1 | T1 |
| OQ-2 | Context assembly | [§5.4](../architecture/tickets.md) | naive rule needed for A1 | A1 / B3 | T2 |
| OQ-3 | Wire protocol details | [§7](../interfaces/wire-protocol.md) | partly resolved (D-42) | A1 / B2 | T3 |
| OQ-4 | Software supply with no network | [§8](../data/environments.md) | **open — largest structural** | B4 | T15 |
| OQ-5 | Terminal conditions and iteration policy | [§6](../interfaces/tool-protocol.md) | open | A1 | T5 |
| OQ-6 | Container loss | [§5.6](../architecture/tickets.md) | open | A2 | T6 |
| OQ-7 | `unshare` vs bubblewrap vs nixos-container | [§11](../sandbox/containers.md) | **resolved for prototype** | B8 | T4 |
| OQ-8 | Overlay root | [§9](../data/storage.md) | **riskiest unvalidated assumption** | B1 | T9 |
| OQ-9 | Boot path and boot-time budget | [§14](../sandbox/vm.md) | open (size settled) | B1 | T10 |
| OQ-10 | Guest init | [§14](../sandbox/vm.md) | systemd is the default; verify | B1 | T11 |
| OQ-11 | GUI/demo transport | [§10](../networking/networking.md) | open, strictly harder | B8 | T18 |
| OQ-12 | How a developer consumes an output | [§8](../data/environments.md) | open | B4 | T19 |
| OQ-13 | Localhost HTTP API and webapp surface | [§15](../architecture/process-model.md) | open | B5 | T23 |
| OQ-14 | Transcript growth | [§5.4](../architecture/tickets.md) | deferred, decision reversible? | B3 | T20 |
| OQ-15 | Server crash semantics | [§15](../architecture/process-model.md) | open | A1 | T8b |
| OQ-16 | Metering | [§5.1](../architecture/components.md) | open, probably "yes from day one" | A1 | T28 |
| OQ-17 | Egress grant model | [§10a](../networking/egress.md) | open | B6 | T24a |
| OQ-18 | IP allowlist maintenance | [§10a](../networking/egress.md) | **likely to force a design change** | B6 | T24b |
| OQ-19 | Update endpoint and key management | [§16a](../data/packaging.md) | security review item | B7 | T30 |
| OQ-20 | L4 relay vs. MITM | [§10a](../networking/egress.md) | deferred, one-way door | after B6 | T24c |
| OQ-21 | TPROXY mechanism verification | [§10a](../networking/egress.md) | **asserted, not proven** | B6 | T24 |
| OQ-22 | Control-channel transport verification | [§14](../sandbox/vm.md), [§15](../architecture/process-model.md) | **asserted, not proven** | B2 | T13a, T23a |

## Detail

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

**Resolved for the prototype: bubblewrap.** The hand-rolled `unshare` recipe was
getting hard to audit, so the coordinator now runs `bwrap … swing-guest container` and
the child runs as PID 1 inside it (D-22). The future exploration is unchanged:
systemd-nspawn / `systemd-run --scope` (OQ-10) and nixos-container (B8) remain the
candidates to evaluate with measurements from A1 and B1.

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
