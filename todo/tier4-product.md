# Tier 4 — shapes the product, decide before it hardens

**Items:** T23 … T29 · **Read this if:** you are working on the surfaces a developer or a
browser actually touches, or on egress. · **Design sections:**
[§10a](../design/networking/egress.md), [§15](../design/architecture/process-model.md),
[§16](../design/data/packaging.md), [§19](../design/overview.md) · **Open questions:**
OQ-13, OQ-17, OQ-18, OQ-20, OQ-21, OQ-22

### T23. Localhost HTTP API and webapp surface  *(OQ-13)*
Who may connect, token distribution, whether the webapp or the TUI is primary, what
the API exposes. After D-27/D-46 the CLI and QEMU channels are private local channels, so
this is the **only remaining loopback TCP server** and the only surface where a token is the
capability boundary — a browser cannot open a Unix socket or a named pipe, so it must have a
port. Decide who may connect and how the token is distributed.

### T23a. CLI↔server transport  *(OQ-22, D-46)*
Move the CLI↔server channel off loopback TCP onto a private local channel: a listening Unix
domain socket (Linux/macOS) or a named pipe with a DACL scoped to the user's SID (Windows).
- Confirm the `sockaddr_un` path-length limit (~104 chars on macOS) — pick a short socket
  path under the state dir.
- Confirm the Windows named-pipe DACL admits only the user's SID.
- Socket-file / pipe lifecycle on server crash (stale socket) — ties to OQ-15 / T8b.
- This removes the handshake token from the CLI channel; the token story stays only on the
  HTTP API surface (T23).

Deferred with the daemon (B5), but the server's design must use the local channel from the
start so the HTTP listener is the only TCP server.

### T24. Mediated egress: verify the mechanism  *(OQ-21)*
Transparent interception via the TPROXY family is chosen (D-32). **The mechanism is
asserted, not proven.** This is the first thing to spike.

Verify:
- Does `ip route add local 0.0.0.0/0 dev lo` + `ip rule add fwmark` deliver **locally
  generated** traffic to a local socket in a namespace that has **only `lo` and no NIC**?
- **How per-container netns (§11) and the interception path coexist.** Containers are
  isolated in their own network namespaces to block backchannels, but the interception
  socket and `skuid` rules live in the guest. How routing tables and firewall config are
  installed per-netns, and how intercepted bytes reach `swing-server` from a netns with
  only `lo`, is the central unknown.
- Is `nft` mangle/`output` with `meta skuid` the right hook, given the TPROXY target
  itself is `prerouting`-only?
- `IP_TRANSPARENT` + `IP_RECVORIGDSTADDR` behavior on accepted sockets; what applications
  see from `getpeername()`.
- Source-address selection, IPv6 parity, UDP/53 handling.
- Whether systemd in the guest (D-36) fights us — systemd may want to own networking
  configuration, and NixOS generates `/etc/resolv.conf`.
- Confirm nothing about this requires a QEMU netdev (D-28 must survive).

**Spike it before designing anything else in this area.** If the mechanism does not work
as described, the whole egress section is rewritten.

### T24a. Egress policy model  *(OQ-17)*
D-38 fixes v1 as deny-by-default IP/CIDR allowlist with blind DNS forwarding to
allowlisted public resolvers. Still to decide:
- Grant lifetime: per ticket, per attempt, time-boxed, or approval that expires.
- Who can grant: human only, model-request with approval, or pre-declared in the ticket's
  environment block.
- **Surfacing denials to the model.** With no visible proxy, a denied connection looks
  like the remote host being down. This is the main usability risk of the transparent
  design and it needs a real answer, not a socket error.
- Port granularity: IP alone vs. IP + port range.
- Byte accounting and the live connections view.
- Confirm the audit path stays structural: the data path *is* the audit path. Do not let
  an implementation drift away from that.

### T24b. Allowlist maintenance and DNS-derived grants  *(OQ-18)*
The likely source of long-term pain.
- CDNs and package registries (GitHub, S3, PyPI, npm) have **rotating addresses**. An IP
  allowlist will be large, stale, or constantly maintained.
- Blind DNS forwarding lets the guest learn real addresses for ungranted hosts; those
  connections are then denied. Correct, but produces confusing failures.
- **DoH bypasses the DNS part of the policy entirely** through any allowed HTTPS endpoint.
  Decide whether DoH endpoints are blocked by default.
- **Prototype DNS-derived grants early:** DNS responses transit our interception path, so
  we can observe which addresses a permitted name resolved to and grant them briefly.
  This keeps the IP mechanism while recovering name-based policy. If it works, most of
  this problem disappears; if it does not, the allowlist becomes an operational burden.
- Decide when we cross from "IP allowlist, honestly labeled" to "hostname allowlist
  implemented via DNS observation" — users will expect the latter.

### T24c. L4 relay vs. MITM  *(OQ-20)*
D-39 fixes L4 relay for v1. If MITM is ever considered: where the CA lives, whether it is
per-installation or shared, how containers are told to trust it, and what we are willing
to promise a developer about their own machine's TLS trust. Decide explicitly; never let
it be decided by implementation convenience.

### T25. Image build pipeline  *(flake)*
- Flake layout; how `base.img` is built, hashed, versioned.
- How the pinned nixpkgs revision is recorded and displayed.
- How a `swing-guest` fix reaches users (new image, new pinned hash) — this now runs
  through T30.
- Reproducibility target: does the same flake rev produce a bit-identical image? This
  matters more now that delta updates depend on stable content.

### T26. Testing strategy
- Golden images in the repo vs. built in CI.
- Integration tests that actually boot QEMU — and whether CI has hardware acceleration.
- Track A's harness should survive A1 and become the test bench for B2.
- Make T14's containment check a CI test, including the "no network backend" build
  assertion from T13.

### T27. Login-start registration per platform
Deferred to B5, but the server must tolerate being started by something other than the
CLI. Options: systemd user unit, LaunchAgent plist, Task Scheduler / Run key. Also
decide whether the VM is expected to survive a host reboot at all — users on Windows
and macOS may expect it to.

### T28. Metering  *(OQ-16)*
We are not throttling, but the server spends real money. Record tokens and cost per
ticket and per attempt. Proposal: yes, from A1, because it is nearly free and it is
very hard to reconstruct later.

### T29. Naming leftovers
`swing`, `swing-server`, `swing-guest` are settled. Still open: subcommand names
(`swing-guest coordinator` vs. default mode), verb set (`swing up` / `swing down` vs.
`swing vm start`), and the state directory path.

---

**Next tier:** [tier5-distribution.md](tier5-distribution.md). **Previous:**
[tier3-structural.md](tier3-structural.md).
