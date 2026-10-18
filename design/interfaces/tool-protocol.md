# Tool protocol

**Sections:** §6 · **Read this if:** you are designing or implementing what the model can
do. · **Depends on:** [../architecture/tickets.md](../architecture/tickets.md) (§5.4 entries)
· **Decisions here:** D-7, D-9, D-43 · **Open:** OQ-1, OQ-5

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

---

**Related:** the frame format these primitives travel in is
[wire-protocol.md](wire-protocol.md) (§7). This section is the input to
[OQ-1](../reference/open-questions.md) — the most important open item in the project —
and is worked as [T1](../../todo/tier1-a1.md). Implemented in
`crates/swing-server/src/tools.rs` and `crates/swing-guest/src/{exec,fs}.rs`.
