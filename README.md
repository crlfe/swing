# Swing — spike (first step)

This is the **first step** from [`design/todo.md`](design/todo.md): the thinnest
thing that puts a model in a container. The UI is a **terminal chat** (stdin /
stdout of `swing-server`) — no TUI, no webapp, no HTTP API, no daemon, no token
auth.

It is a **skeleton**: the structure and the framed server↔guest boundary are
real, the hard parts are marked `TODO`. Organization is deliberately simple and
will change as we prototype.

## What is real vs. deferred

Real (the spike's point):

- **Framed two-process boundary** (`swing-server` ↔ `swing-guest`) over one
  loopback TCP socket using the §7 binary frame format (D-42). Keeping this
  boundary from day 1 means the later virtio-serial swap is a config change, not
  a rewrite.
- **OpenAI-compatible Chat Completions** provider (D-41), configured via
  `OPENAI_BASE_URL` (required) / `OPENAI_MODEL` / `OPENAI_API_KEY` (optional).
  Complete-response tool calls (no streaming).
- **The four tools** (D-43): `shell` (`sh -c`), `read_file`, `write_file`,
  `list_dir`, dispatched as remote exec/fs to the guest.
- **Naive context rule** (T2): full transcript every turn.
- **Terminal condition** (T5): "model produced text with no tool call" ends the
  turn and hands control back to the human. Max 40 iterations per attempt.

Deferred (explicitly out of this spike — see todo.md):

- `unshare` / container fork / cgroups (T4): exec/fs run against a **plain work
  directory**.
- Ticket DB, daemon, pidfile, crash semantics (T8, T8b).
- Scheduler, DAG, parking, `report`/`park`/`open_ticket` tools (T5, T6).
- Cancellation, timeouts, bulk-stream chunking for large payloads (T3).
- Nix environments, `base.img`, QEMU, egress (Tier 2+).

## Layout

```
Cargo.toml                 # workspace
schema.toml                # message set (docs; source of truth is swing-proto/src/msg.rs)
crates/
  swing-proto/             # §7 wire protocol: binary frames + message set
    src/frame.rs           # fixed header + JSON header + opaque body codec
    src/msg.rs             # tagged message enum (exec/fs/handshake/lifecycle)
    src/transport.rs       # Conn: byte stream <-> typed frames, per-stream seq
  swing-server/            # host supervisor (spike): terminal chat
    src/main.rs            # stdin/stdout chat loop
    src/config.rs          # env config (D-41)
    src/provider.rs        # OpenAI-compatible Chat Completions client
    src/session.rs         # agent loop (T2 full transcript, T5 terminal rule)
    src/tools.rs           # model-facing tool schema + dispatch (T1)
    src/guest.rs           # client to swing-guest over the control channel
  swing-guest/             # guest coordinator (spike)
    src/main.rs            # loopback listener + handshake + dispatch
    src/exec.rs            # sh -c, stream stdout/stderr, exec_exit
    src/fs.rs              # read/write/list against the work dir
```

## Build

```sh
cargo build
```

## Run

Start the guest first (it listens on loopback; its work dir is the process cwd):

```sh
# Run from whatever directory you want to act as the workspace.
SWING_GUEST_ADDR=127.0.0.1:7700 cargo run -p swing-guest
```

Then the server (terminal chat) in another shell:

```sh
# Required: the provider endpoint. There is no default, so a missing base URL
# never sends your key to a provider you didn't choose.
export OPENAI_BASE_URL=https://api.openai.com/v1
# Optional: omit MODEL to skip the `model` field; omit API_KEY to skip the
# `Authorization` header.
export OPENAI_MODEL=gpt-4o-mini
export OPENAI_API_KEY=sk-...
cargo run -p swing-server
```

Type a message; the model may call tools (which run in the guest's work dir) and
the turn ends when it replies with plain text. `:quit` exits.

## Notes on the protocol

- Frame layout and the message set are documented in [`schema.toml`](schema.toml)
  and implemented in `crates/swing-proto`. Keep the two in sync (OQ-3 / T3).
- Max frame size is a protocol constant: **4096 bytes** (D-42, provisional).
  Large payloads are meant to be chunked on the bulk stream; the spike caps
  single-frame payloads instead (see `TODO` in `swing-guest/src/fs.rs`).
- File contents and command output travel in the frame **body** as opaque bytes,
  never as escaped strings (design.md §6).
