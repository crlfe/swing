# Tier 1 — blocks A1 (the PoC)

**Items:** T1 … T8b · **Read this if:** you are building the QEMU-free PoC and need the
decisions it forces. · **Design sections:** [§5](../design/architecture/tickets.md),
[§6](../design/interfaces/tool-protocol.md), [§7](../design/interfaces/wire-protocol.md),
[§11](../design/sandbox/containers.md) · **Open questions:** OQ-1, OQ-2, OQ-3, OQ-5, OQ-6,
OQ-7, OQ-15

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

**Spike status.** Happy path confirmed against a real model: valid JSON args for all
four tools, idiomatic `sh -c` command strings (`wc -l < f`, `mkdir d`), sensible tool
chaining, and a clean terminal condition. D-43 confirmed — the model reaches for
`shell` for filesystem ops the fs tools don't cover. **Open finding — tool error
recovery:** `read_file` feeds guest errors back to the model as actionable text
(`[error: no_such_file]`), but `shell`/`write_file`/`list_dir` propagate them with `?`,
which aborts the whole attempt (the model never sees the error and cannot recover).
Truncation and error-recovery paths are still untested. Captured in
`swing-server/src/tools.rs` (`TODO (T1, tool error recovery)`); fix so every tool-level
failure returns actionable text and reserves attempt-level failure for transport/guest
death, then re-run the adversarial prompts.

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
- **Frame budget for header-carried data.** `MAX_BODY` reserves 256 bytes for the JSON
  header, which is fine for `exec_output` and `fs_read`, but `fs_result` carries
  `entries` *in the header*: a directory of roughly 80 entries overflows 4 KiB and the
  call fails outright. Decide list truncation plus a `truncated` flag, or move
  listings to the bulk stream (see the `fs.rs` TODO).
- Backpressure: what happens when the channel fills while an `exec` is streaming.
- Define the message set in `schema.toml` so both sides and `swing trace` share one
  definition.
- **How many channels.** D-27 (revised) fixes the transport as a private local channel —
  an inherited fd (Unix) or a named pipe (Windows) — not a loopback port. The open question
  is whether control, exec, bulk, and (later) egress get separate fds/pipes or share one
  with a `stream` field. Measure in B1 spike 3, but the `stream` field must be right now.
- **Handshake token is no longer the QEMU-channel capability boundary.** The fd / pipe
  handle is (D-44, D-45). A token story is still needed for the CLI↔server / HTTP API
  surface (OQ-13, T23); a `hello`/build-id handshake still exists to catch version
  mismatches, but it is not an auth mechanism for the QEMU channel.

**Track A discipline:** the transport is a byte stream and only framed messages cross
it. A `socketpair()` between `swing-server` and `swing-guest`, the Unix form of production.
No reliance on fd inheritance beyond the connected stream itself, no exit codes, no signals
across the boundary. If we hold this, swapping the socketpair for a virtio-serial chardev is
a configuration change.

### T4. Container setup, minimal  *(OQ-7)*
Decide for A1:
- ~~Exact `unshare` flags and ordering; `pivot_root` vs a tmpfs root~~ — resolved:
  bubblewrap owns the namespaces/mount/pivot (D-22, OQ-7); we only choose the bind
  set.
- Whether user namespaces are used (host dependency; NixOS and most distros allow
  them, but confirm on the dev machines).
- Work directory layout on the host for the PoC (`state/workspaces/<ticket>/`).
- cgroup creation without systemd: write cgroupfs directly, or defer cgroups to
  Track B. Proposal: do it in A1 — fault isolation is cheap and we want the code path
  exercised early. Note this code may be replaced by `systemd-run --scope` in the guest
  (D-36), so keep it isolated in one module.

**Spike status (implemented, always on, unverified).** The coordinator spawns
`bwrap … swing-guest container` children; bubblewrap builds the sandbox and runs the
child as PID 1 of its own PID namespace before it reads its first frame — there is no
`--sandbox` flag and no `SWING_SANDBOX` env var, and a child whose sandbox fails to
set up dies instead of serving unsandboxed. bubblewrap flags (built in
`swing-guest/src/sandbox.rs`): `--unshare-user --unshare-all` (user+mount+pid+net+ipc+uts),
uid/gid map to the caller uid, `--disable-userns`, `--die-with-parent`, a
tmpfs root with a read-only toolchain bind set (`SWING_SANDBOX_BINDS`, default
`/bin:/usr:/lib:/lib64:/etc`), a read-write `/work` bind, `proc`, tmpfs `/tmp`, and
`--dev`; bubblewrap's own default capability drop covers the payload's capability
set. The child keeps only `PR_SET_NO_NEW_PRIVS` + `PR_SET_PDEATHSIG`. bubblewrap
is now a runtime dependency (override with `SWING_BWRAP`). Unprivileged user
namespaces confirmed on the dev box; bubblewrap presence to be confirmed on the test
box.

**Still open for T4 (needs on-box iteration):**
- Verify the recipe *contains* (T14 canary test). The path-protection tests now
  run against a sandboxed container and show the shell cannot reach a host
  canary, which proves the recipe *runs*; the direct boundary probes
  (mountinfo, `/proc/net/dev`, `NoNewPrivs`, `CapBnd`, pid 1) are still to be
  written.
- Confirm bubblewrap's default capability drop actually clears the payload's
  **effective/permitted** sets (the `CapBnd`/`CapEff` probe above is how), rather
  than assuming it.
- The read-only bind set is a host-dependent stopgap — the real toolchain supply is
  T15/OQ-4.
- cgroup `memory.max` / `pids.max` (§11) not yet wired. Note `--unshare-all` puts
  the container in its own cgroup namespace on newer bubblewrap; check what the
  coordinator can see before wiring limits (D-25).
- Per-container distinct uid inside the userns (host-side distinct uid is a Track B
  / egress concern).

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

**Next tier:** [tier2-b1.md](tier2-b1.md). **Previous:** [first-step.md](first-step.md).
