# First step — the smallest useful spike

**Read this if:** you are about to write code. This is the leading edge of A1; everything
in [tier1-a1.md](tier1-a1.md) is decided *against* what this spike teaches us.
· **Blocks:** A1 · **Items here:** T1 … T8b (see tier1)

Build the thinnest thing that puts a model in a container. **The UI is a terminal
chat** — stdin/stdout of the server process — so there is no TUI, no webapp, no HTTP
API, no daemon, and no token auth in this step.

**Hard blockers — settle these before writing code:**
- **Provider + tool-calling API (T7).** **Decided (D-41): OpenAI-compatible Chat
  Completions**, configured via `OPENAI_BASE_URL` / `OPENAI_MODEL` / `OPENAI_API_KEY`.
  Use **complete-response tool calls, not streaming**. The provider is a swappable
  server-side detail. Remaining open: tool-schema feature vs prompt-based invocation,
  retry/error taxonomy.
- **Frame format + one local channel + the two-process split (T3).** **Decided (D-42):
  serde (`serde_json`) header, max frame size 4 KiB** (provisional). Implement the §7
  header over a single `socketpair()` (the Unix form of the production transport) with the
  `stream` field multiplexing control/exec/log. **Done:** the server now spawns
  `swing-guest` and wires the §7 header over a `socketpair()` it hands the child as its
  stdin/stdout (inherited fd; no socket file, no listener). Still open (non-blocking):
  `schema.toml`, channel count, backpressure.
- **Tool schema for the four tools (T1).** **Decided (D-43): `shell` takes a `command`
  string** (run via `sh -c`). The §6 draft is enough to start; still pin a truncation
  marker and model-actionable error shapes (`no_such_file`, not a raw errno).
- **Naive context rule (T2).** Full transcript every turn.
- **Minimal terminal condition (T5).** "Model produced text with no tool call" = end of
  turn → hand control back to the human. No `report`/`park` tools yet.

**De-risked ordering:**
1. **Day 0 (throwaway):** in-process chat loop + real provider + the four tools on a
   plain work directory. Answers the highest-value unknown — does the tool surface work
   against a real model — in an afternoon. **Done.** Happy path confirmed against a real
   model (all four tools, sensible chaining, clean terminal condition). Failure paths
   (truncation, error recovery, workspace-boundary) still untested — see T1.
2. **Split out `swing-guest`** behind the §7 frame format over one `socketpair()`;
   tools become remote exec/fs. Keep the framed server↔guest boundary from day 1 of the
   *real* spike — collapsing it into one process makes the later virtio-serial swap a
   rewrite, not a config change. **Done.** `swing-guest` is now a coordinator that spawns
   container children (via `Command` + a `socketpair` as the child's
   stdin/stdout) and routes exec/fs frames by container id.
3. **Add the sandbox** around the work directory (T4). Defer it: run exec/fs against a
   plain directory first. This also sidesteps whether unprivileged user namespaces work
   on the dev box, and the fact that distinct-uid allocation is not possible
   unprivileged. **In progress.** Unprivileged user namespaces confirmed on the dev box.
   The sandbox is now **bubblewrap** (`bwrap … swing-guest container`, child as PID 1;
   flags built in `swing-guest/src/sandbox.rs`), **always on** (the `SWING_SANDBOX`
   switch has been removed) and **not yet verified to contain** — see T4 for what
   remains.

**Explicitly deferred out of this spike** (do not design them now): webapp / HTTP API /
token auth (OQ-13, T23); daemon, pidfile, login-start, crash semantics (OQ-15, T8b);
scheduler, DAG, parking, `blocked_on` (T6, T22); ticket DB format (T8); Nix environment,
`base.img`, software supply (OQ-4, T15, T16); egress / TPROXY (T24); image build /
overlay / systemd (T9–T11).

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

**Next:** the detail behind each of the five is in [tier1-a1.md](tier1-a1.md). The spike
itself is the repo root: see [`README.md`](../README.md).
