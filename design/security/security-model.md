# Security model

**Sections:** §13 · **Read this if:** you want the boundaries, the supply chain, and what we
have deliberately left unsolved. · **Depends on:** [../overview.md](../overview.md) (principles),
[../sandbox/vm.md](../sandbox/vm.md), [../sandbox/containers.md](../sandbox/containers.md),
[../networking/egress.md](../networking/egress.md) · **Decisions here:** D-2, D-21, D-28, D-45
· **Open:** OQ-13, OQ-19

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
  [§16a](../data/packaging.md)). The download endpoint, the signing key, and the
  delta-application path become as trusted as the flake build.

---

**Related:** the standing accepted risks are in [accepted-risks.md](accepted-risks.md) ·
prompt injection against network tools is [T17](../../todo/tier3-structural.md) ·
secrets beyond LLM keys are [T21](../../todo/tier3-structural.md) · the update channel is
[OQ-19](../reference/open-questions.md) and [T30](../../todo/tier5-distribution.md).
