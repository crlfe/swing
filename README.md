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

- **Framed two-process boundary** (`swing-server` ↔ `swing-guest`) over a single
  byte-stream channel using the §7 binary frame format (D-42). The server **spawns**
  `swing-guest` and hands it one end of a `socketpair()` as its control channel — the Unix
  form of the private local channel (revised D-27); production swaps that fd for a
  virtio-serial chardev (and a named pipe on Windows). No loopback TCP, no port, no socket
  file. Keeping the framed boundary from day 1 means the swap is a config change, not a rewrite.
- **OpenAI-compatible Chat Completions** provider (D-41), configured via
  `OPENAI_BASE_URL` (required) / `OPENAI_MODEL` / `OPENAI_API_KEY` (optional).
  Complete-response tool calls (no streaming).
- **The four tools** (D-43): `shell` (`sh -c`), `read_file`, `write_file`,
  `list_dir`, dispatched as remote exec/fs to the guest.
- **Naive context rule** (T2): full transcript every turn.
- **Terminal condition** (T5): "model produced text with no tool call" ends the
  turn and hands control back to the human. Max 40 iterations per attempt.

Deferred (explicitly out of this spike — see todo.md):

- Cgroups (T4): the container sandbox is bubblewrap, but cgroup `memory.max` /
  `pids.max` fault isolation is deferred.
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
  swing-guest/             # guest: coordinator + container children
    src/main.rs            # arg dispatch: coordinator vs `container` child
    src/coordinator.rs     # inherited socketpair channel, handshake, spawn bwrap + route by id
    src/container.rs       # child: PID 1 under bubblewrap; payload hardening, then serve
    src/sandbox.rs         # bubblewrap flags + payload hardening (T4)
    src/exec.rs            # sh -c, stream stdout/stderr, exec_exit
    src/fs.rs              # read/write/list against the work root
```

## Build

```sh
cargo build
```

## Run

Run the server. It **spawns `swing-guest` as a child** and hands it one end of a
`socketpair` as its control channel (revised D-27); the coordinator in turn spawns a
`bwrap … swing-guest container` child per container id.

```sh
# Required: the provider endpoint. There is no default, so a missing base URL
# never sends your key to a provider you didn't choose.
export OPENAI_BASE_URL=https://api.openai.com/v1
# Optional: omit MODEL to skip the `model` field; omit API_KEY to skip the
# `Authorization` header.
export OPENAI_MODEL=gpt-4o-mini
export OPENAI_API_KEY=sk-...

# The server spawns the guest binary (default: a `swing-guest` sibling of the
# server binary in the cargo target dir; override with SWING_GUEST_BIN). The
# workspace is the server's cwd (override with SWING_WORK_DIR).
cargo run -p swing-server
```

The container sandbox is **bubblewrap**: the coordinator runs `bwrap … swing-guest
container` and the child runs as PID 1 inside it. It is **always on** — there is no
`SWING_SANDBOX` switch, and a container whose sandbox fails to set up dies rather
than serving unsandboxed. It is *not yet verified to contain* — see todo.md T4/T14.
Knobs:

- `SWING_SANDBOX_BINDS` — colon-separated absolute host paths bound read-only as
  the toolchain (default `/bin:/usr:/lib:/lib64:/etc`).
- `SWING_BWRAP` — the bubblewrap binary to run (default `bwrap`).

`swing-guest` is never run standalone — the server always spawns it.

Type a message; the model may call tools (which run in the guest's work dir) and
the turn ends when it replies with plain text. `:quit` exits.

## Tests

```sh
cargo test                                   # whole workspace
cargo test -p swing-guest                    # path policy + control-channel tests
```

The guest tests spawn the real `swing-guest` binary and drive frames at it, so
they need bubblewrap installed and unprivileged user namespaces — the container is
always sandboxed. If bubblewrap is missing or your box blocks user namespaces
(AppArmor does on some distros) they fail with bubblewrap's error rather than
skipping quietly.

## Notes on the protocol

- Frame layout and the message set are documented in [`schema.toml`](schema.toml)
  and implemented in `crates/swing-proto`. Keep the two in sync (OQ-3 / T3).
- Max frame size is a protocol constant: **4096 bytes** (D-42, provisional).
  Large payloads are meant to be chunked on the bulk stream; the spike caps
  single-frame payloads instead (see `TODO` in `swing-guest/src/fs.rs`).
- File contents and command output travel in the frame **body** as opaque bytes,
  never as escaped strings (design.md §6).
