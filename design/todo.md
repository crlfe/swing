# Swing — TODO

Companion to [`design.md`](design.md). Ordered by when it blocks us, not by
importance. Two tracks run in parallel: **A** = QEMU-free Linux PoC, **B** =
buildability spikes. Milestones are ordered by dependency, not by a fixed "v1" cut —
where the first product-quality version lands is deliberately left open.

Resolved since the last version, so they are no longer listed here: **container
lifetime tied to ticket status — created on start, destroyed only on delete, parking
keeps the container (D-35, revised)**, control-channel transport (D-19, D-27), network
backend rejection (D-28 … D-31), image size budget (D-36), **egress mechanism switched
from SOCKS5 to transparent interception (D-32, D-38 … D-40)**.

---

## First step — the smallest useful spike

Build the thinnest thing that puts a model in a container. **The UI is a terminal
chat** — stdin/stdout of the server process — so there is no TUI, no webapp, no HTTP
API, no daemon, and no token auth in this step.

**Hard blockers — settle these before writing code:**
- **Provider + tool-calling API (T7).** **Decided (D-41): OpenAI-compatible Chat
  Completions**, configured via `OPENAI_BASE_URL` / `OPENAI_MODEL` / `OPENAI_API_KEY`.
  Use **complete-response tool calls, not streaming**. The provider is a swappable
  server-side detail. Remaining open: tool-schema feature vs prompt-based invocation,
  retry/error taxonomy.
- **Frame format + one loopback socket + the two-process split (T3).** **Decided (D-42):
  serde (`serde_json`) header, max frame size 4 KiB** (provisional). Implement the §7
  header over a single loopback TCP socket with the `stream` field multiplexing
  control/exec/log. Still open (non-blocking): `schema.toml`, port count, backpressure.
- **Tool schema for the four tools (T1).** **Decided (D-43): `shell` takes a `command`
  string** (run via `sh -c`). The §6 draft is enough to start; still pin a truncation
  marker and model-actionable error shapes (`no_such_file`, not a raw errno).
- **Naive context rule (T2).** Full transcript every turn.
- **Minimal terminal condition (T5).** "Model produced text with no tool call" = end of
  turn → hand control back to the human. No `report`/`park` tools yet.

**De-risked ordering:**
1. **Day 0 (throwaway):** in-process chat loop + real provider + the four tools on a
   plain work directory. Answers the highest-value unknown — does the tool surface work
   against a real model — in an afternoon.
2. **Split out `swing-guest`** behind the §7 frame format over one loopback socket;
   tools become remote exec/fs. Keep the framed server↔guest boundary from day 1 of the
   *real* spike — collapsing it into one process makes the later virtio-serial swap a
   rewrite, not a config change.
3. **Add `unshare`** around the work directory (T4). Defer it: run exec/fs against a
   plain directory first. This also sidesteps whether unprivileged user namespaces work
   on the dev box, and the fact that distinct-uid allocation is not possible
   unprivileged.

**Explicitly deferred out of this spike** (do not design them now): webapp / HTTP API /
token auth (OQ-13, T23); daemon, pidfile, login-start, crash semantics (OQ-15, T8b);
scheduler, DAG, parking, `blocked_on` (T6, T22); ticket DB format (T8); Nix environment,
`base.img`, software supply (OQ-4, T15, T16); egress / TPROXY (T24); image build /
overlay / systemd (T9–T11).

This is the leading edge of A1; everything in Tier 1 below is decided *against* what
this spike teaches us.

---

## Decide in the first week

Five items gate the first week of Track A, and all five are cheap to settle (T4, T6 and
T8 also block A1 but can be settled a little later in the week):

1. **Tool surface** — the four tools and their exact semantics (T1).
2. **Naive context assembly rule** — how a ticket becomes a prompt (T2).
3. **Frame format finalization** — fields, max size, header serialization (T3).
4. **Terminal conditions** — what ends a session (T5).
5. **Provider + API shape** — **decided (D-41): OpenAI-compatible Chat Completions**;
   remaining: tool-schema vs prompt-based invocation, streaming (T7).

---

## Tier 1 — blocks A1 (the PoC)

### T1. Tool surface  *(OQ-1)*
**The most important design item in the project.** Track A exists mostly to answer
this.

Decide:
- The four v1 tools and their exact argument shapes.
- Truncation: what limit, what marker, does the model know it was truncated, can it
  ask for the next chunk.
- Error shapes the model can actually act on (`no_such_file` vs. a raw errno).
- How the model learns the workspace layout — is `/work` stated in the prompt, is
  there a `pwd`-like tool, does `list_dir` run implicitly at session start.
- **Decided (D-43): `shell` takes a `command` string** (run via `sh -c`), not `argv`.
  Models are much better at command strings; the server must quote/escape correctly.
- How many tools is too many. Four is the proposal; confirm.

Why it matters: model competence against your tool surface is the whole product, and
it is the thing you most do not want to discover after building a VM.

### T2. Context assembly  *(OQ-2)*
Decide a naive rule for A1, even though real management is B3:
- Full transcript every turn, or last N entries?
- Are tool results from earlier turns kept verbatim or summarized?
- How human comments are injected and attributed.
- Whether the assembled prompt is itself recorded (the design says yes — confirm,
  because it doubles transcript size).

### T3. Wire protocol details  *(OQ-3)*
Decide:
- **Decided (D-42): serde (`serde_json`) header, max frame size 4 KiB** (provisional;
  large payloads chunked on the bulk stream). Field set and offsets per §7.
- Backpressure: what happens when the channel fills while an `exec` is streaming.
- Define the message set in `schema.toml` so both sides and `swing trace` share one
  definition.
- **How many loopback listeners and ports.** D-27 fixes the transport as loopback TCP
  everywhere; the open question is whether control, exec, bulk, and (later) egress get
  separate sockets/ports or share one with a `stream` field. Measure in B1 spike 3, but
  the `stream` field must be right now.
- Handshake token format and rotation, given that the loopback socket is now the only
  capability boundary.

**Track A discipline:** the transport is a byte stream and only framed messages cross
it. Loopback TCP between `swing-server` and `swing-guest`, same as production. No fd
inheritance, no exit codes, no signals across the boundary. If we hold this, swapping
the loopback socket for a virtio-serial chardev is a configuration change.

### T4. Container setup, minimal  *(OQ-7)*
Decide for A1:
- Exact `unshare` flags and ordering; whether we use `pivot_root` or just a tmpfs
  root with bind mounts.
- Whether user namespaces are used (host dependency; NixOS and most distros allow
  them, but confirm on the dev machines).
- Work directory layout on the host for the PoC (`state/workspaces/<ticket>/`).
- cgroup creation without systemd: write cgroupfs directly, or defer cgroups to
  Track B. Proposal: do it in A1 — fault isolation is cheap and we want the code path
  exercised early. Note this code may be replaced by `systemd-run --scope` in the guest
  (D-36), so keep it isolated in one module.

### T5. Terminal conditions and iteration policy  *(OQ-5)*
Decide:
- Explicit terminal tools: `report`, `park`, `open_ticket`.
- Max iterations per attempt (proposal: 40).
- What "the model asked for no tool call" means — treat as implicit report, or as an
  error.
- What each outcome looks like as a ticket entry.

### T6. Session/container state machine  *(OQ-6)*
Container lifetime is settled (D-35, revised): created when the ticket first starts,
kept across attempts and parking, destroyed only on `swing ticket delete` (or VM stop).
Parking keeps the container alive. Still open:
- Container dies mid-session: restart the container and continue the same session, or
  fail the attempt. Proposal for A1: **fail the attempt**, revisit at A2.
- Where the state machine lives (server only) and what the guest is told.
- When (if ever) a `done`/`failed` container is reclaimed before the ticket is deleted
  — idle containers are cheap, but not free.
- What "resume" means when the same container survives parking: does the model get a
  fresh `list_dir`, or is its assumed state trusted?

### T7. Provider integration
**Decided (D-41): OpenAI-compatible Chat Completions**, configured via
`OPENAI_BASE_URL` / `OPENAI_MODEL` / `OPENAI_API_KEY`; complete-response tool calls for
the spike. Still to decide:
- Whether we use the provider's tool schema feature or prompt-based tool invocation.
- Streaming tool calls vs. complete-response tool calls (the spike uses complete-response).
- Retry and error taxonomy, and how provider failures appear in the ticket.
- Provider web search (if any) stays **host-only** and is never routed through the
  egress subsystem (D-34).

### T8. Ticket file format and comment UX
Decide:
- On-disk format for the host ticket DB (one JSON file per ticket? append-only JSONL
  entries + a metadata file?).
- `swing ticket comment` semantics: does commenting reopen a `done` ticket, and does
  it auto-schedule a new attempt or wait for an explicit `swing ticket resume`?
  Proposal: comment reopens to `open`; scheduling is explicit.
- Entry size caps (ties to T20).

### T8b. Server crash semantics  *(OQ-15)*
Not previously tracked; add it now because `swing up` must be correct from A1.
- Pidfile / lock format and the adopt-or-kill rule for an orphaned QEMU child (or an
  orphaned Track-A `swing-guest`).
- What `swing up` reconstructs after a crash, and whether in-flight sessions resume or
  simply fail.
- How a crashed attempt is recorded in the ticket.

---

## Tier 2 — blocks B1 (a bootable image)

### T9. Overlay root  *(OQ-8)*
**Highest technical risk in the design.** NixOS stage-1 and its initrd have opinions
about the root filesystem; an overlayfs root spanning a read-only base plus a writable
second disk may fight them.

Decide:
- Does stage-1 support it, or do we need a custom init?
- Confirm the rejection of qcow2 backing files.
- Fallback: writable `base.img`, giving up immutability for v1. Cheaper, but weakens
  "reset is trivial" and "base is hashable" — and it also weakens the delta-update
  story in T28, which depends on an immutable, content-addressed base.

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

### T14. Containment verification method  *(B1 spike 4)*
Decide what "prove nothing escapes" means concretely: a strace/auditd sweep, a
read-only host filesystem, a dedicated uid with no readable home directory, a canary
file. Make it repeatable so it becomes a CI test, not a one-off demo. Include a check
that QEMU has no network capability.

---

## Tier 3 — structural, decide before they harden

### T15. Software supply with no network  *(OQ-4)*
**The largest open structural question.** With no NIC in the VM, new software arrives
only from `base.img` or via server-pushed transfer.

Options:
- (a) Everything from `base.img`; "request additional software" deferred.
- (b) Server implements enough of the Nix HTTP binary-cache protocol to fetch
  `.narinfo`/`.nar`, verify signatures host-side, and stream closures into the guest
  store.
- (c) Guest store fixed; tickets choose only from what is present.

**Constraint now recorded (D-33):** supply must be an explicit, recorded, verified
fetch. It must **not** be solved by giving containers a network tunnel, because a
transparent tunnel makes dependency trees unverifiable and unreproducible and would
let dependency supply inherit the runtime egress policy.

Related: where signature verification happens if the server fetches; whether
agent-built derivations are visible to other tickets before explicit publish; how big
a pushed closure can get over the bulk stream.

### T16. Baseline environment contents
Decide the exact `environment.systemPackages` set in the flake. With a 1 GB budget it
can be generous — `sh`, coreutils, `grep`, `sed`, a diff, `git`, maybe a compiler
toolchain — but confirm what actually belongs in the baseline versus what tickets must
request. Also decide whether the baseline is versioned independently of ticket
environments.

### T17. Prompt injection and network tools  *(new)*
`swing-server` now executes network tools on the model's behalf. A prompt-injection
attack that persuades a session to call `web_fetch` against an attacker endpoint is a
host-side risk with no VM boundary involved.

Decide before any network tool ships:
- Allowlist vs. deny-by-default vs. per-ticket grants.
- Whether fetched content is marked as untrusted when it enters the transcript.
- Whether `git_clone` is allowed at all in v1.
- That mediated egress (T24) **enlarges** this risk: any code in a container,
  including a malicious dependency, can open connections subject to an L4 filter.

### T18. GUI/demo transport  *(OQ-11)*
No NIC means no VNC-over-TCP, and the two obvious escapes were rejected: passt (not
portable, D-30) and `-netdev dgram` (packet pipe, D-31). Options remaining: virtio-gpu
+ screenshots over the bulk stream; a Wayland socket proxied over a virtio-serial
chardev; SPICE over a chardev.

Also decide now, even though the milestone is late:
- Commit to a headless VM with no local display device.
- The GUI milestone introduces a **human → container input channel**, a new trust
  boundary. Write it down so nobody assumes the boundary is one-directional.

### T19. How a developer consumes an output  *(OQ-12)*
Host has no Nix; VM has no network. "Publish a nix package" is well-defined inside the
VM; delivery to plain Windows or macOS is unresolved. Options: run it in the VM and
expose the result (ties to T18); export a portable bundle; export the closure for
archival only.

Likely answer is "execution stays in the VM, export is for inspection," which makes
T18 load-bearing rather than cosmetic. Needs an answer before B4.

### T20. Transcript growth and context management  *(OQ-14)*
Recording everything means tickets can reach hundreds of megabytes.

Decide: per-entry size caps; whether large tool results are stored as external blobs
referenced by the entry; when the ticket stops being a readable document; and the
summarize/collapse/prune strategy for context (B3).

### T21. Secrets beyond LLM keys
GitHub tokens, database URLs, API keys for services under test. Decide whether the
server is the only secrets broker, whether per-ticket scoped grants are possible, and
what the ticket records about which secrets an attempt had access to.

### T22. Scheduler semantics under real tickets
- Failure propagation: does a failed child fail the parent or just block it.
- Retry policy: none in v1 — confirm acceptable.
- Parking triggers: model-declared only, or also silence/timeout detection.
- Ticket tree depth limits; total-ticket caps per session.
- Tickets blocked on tickets that get abandoned.

---

## Tier 4 — shapes the product, decide before it hardens

### T23. Localhost HTTP API and webapp surface  *(OQ-13)*
Who may connect, token distribution, whether the webapp or the TUI is primary, what
the API exposes. This is the first host-side listener a browser touches, and with
D-27 loopback TCP is now the single mechanism everywhere — so the token is the only
thing distinguishing an authorized client from any other local process.

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

## Tier 5 — image distribution (B7), treat as a security review item

### T30. Update mechanism design  *(OQ-19)*
Signed manifest + content-defined chunking + resume + delta + verify-then-swap +
rollback is the chosen shape (D-37). Decide:

- **Where images and chunks are hosted**, and the chunk store layout.
- **CDC tooling**: the `casync` family vs. `xdelta3`/bsdiff. Preference for CDC for
  disk images; confirm the Rust story (is there a maintained CDC implementation, or do
  we shell out, or do we use a simpler fixed-block scheme with a content index?).
- **Signing key custody and rotation.** Who holds it, how a key is retired, what a
  client does on signature failure, how a bad release is revoked.
- **What the manifest pins**: image hash, `swing` version range, `swing-guest` version,
  QEMU version. This manifest is what makes D-15 workable over a network.
- **Resume semantics**: at chunk granularity via HTTP range requests, not one blob.
- **Cache layout** keyed by content hash, and its GC policy.
- **Offline fallback**: a bundled image, or a "copy the cache directory" path. First
  run now requires host network; state the air-gapped story even if it is low priority.
- **Rollback and bricking**: what happens if a delta is applied and the new image is
  broken.

**Treat the download endpoint, the signing key, and the delta-application path as
supply-chain components equal in trust to the flake build.** A compromised delta
compromises the VM image for every user.

---

## Watch list — accepted risks, not decisions

- **Track A becoming the product.** `unshare` protects the host's files; it is not a
  kernel boundary, it requires host user namespaces, and it does nothing on Windows.
  The security story is incomplete until Track B lands.
- **QEMU is the security boundary**, so we inherit its device-model CVE history.
  Mitigated by device minimization, no network backend compiled in, and Linux
  `-sandbox on`; not solved.
- **`swing-server` is now the most powerful component**: host network, credentials,
  and network tools executed on the model's behalf. See T17 and T24.
- **`swing-guest` runs as root in the guest** and is trusted by the server. A
  compromised guest equals a compromised VM.
- **Workspaces do not survive VM shutdown** in v1. Stated, accepted, deferred.
- **Acceleration may be unavailable** (Windows without Hyper-V, cloud VMs without
  nested virt). TCG is correct but unusable; plan the error message.
- **Boot time is now the open budget, not image size.** 1 GB is allowed (D-36), which
  makes systemd the default — but systemd costs time, and T10's target is unmeasured.
  If boot time fails badly, the minimal-init question returns even though size does not
  permit it.
- **Recording everything is expensive.** T20 is deferred, but the *decision to record*
  is already made; make sure it is reversible.
- **The update channel is the new supply-chain front door** (T30). It is easier to get
  wrong than the flake is.
- **Rejected options may come back.** slirp, passt, and `-netdev dgram` are all out
  (D-29 … D-31). Transparent interception (D-32) resolves the transparency problem that
  made them attractive, so the pressure to revisit should drop — but if the TPROXY-family
  mechanism fails the T24 spike, they come back immediately and the egress section is
  rewritten.
- **The egress mechanism is asserted, not proven** (T24). The `local`-route + `fwmark` +
  `IP_TRANSPARENT` recipe for *locally generated* traffic in a NIC-less namespace is the
  load-bearing claim in §10a of the design. Spike it before designing the policy layer.
- **An IP allowlist will age badly.** CDNs and package registries rotate addresses;
  blind DNS forwarding produces many correct-but-confusing denials; DoH bypasses the DNS
  policy. DNS-derived grants (T24b) are the likely fix and deserve early prototyping.
- **Transparent interception hides its own failures.** With no visible proxy, a denial
  looks like a dead remote host. This is a model-competence problem, not just a UX one:
  a model that cannot tell "denied" from "unreachable" will retry, guess, and waste
  attempts.
- **`swing-guest` gains `CAP_NET_ADMIN` semantics** when egress ships. It is already
  root, but the interception setup is a distinct capability and should stay scoped to it.
- **MITM is a one-way door** (T24c). Installing our CA in containers on developer machines
  is easy to add and hard to remove.
