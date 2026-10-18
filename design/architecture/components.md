# Components — detail

**Sections:** §5.1–§5.3 · **Read this if:** you want to know what each binary is and does.
· **Depends on:** [overview.md](../overview.md) (the §5 map) · **Decisions here:** D-4, D-5,
D-6, D-7, D-21 · **Open:** —

The map is in [overview.md §5](../overview.md).

## 5.1 `swing` and `swing-server` — one binary, host platform

One executable, two modes:

```
swing                      # attach to server, show TUI
swing up                   # start the server if not running, then attach
swing ticket new count.yaml
swing ticket comment T-42 "try the other approach"
swing ticket delete T-42       # destroy the container and workspace
swing watch T-42
swing trace                # pretty-print control-channel frames
swing down                 # stop the VM and the server
swing status
```

`swing-server` is the long-lived supervisor. It owns the QEMU child, the ticket
database, LLM provider connections, the scheduler, and the control channel to QEMU (an
inherited fd on Unix, a DACL-secured named pipe on Windows). CLI invocations are thin
clients of it over a private local control channel (a Unix socket file on Linux/macOS, a
named pipe on Windows). This is the `docker` / `wsl` shape: the supervisor pattern is the
same on all three host platforms, though the channel object itself is platform-native.
Built for the host platform. Rust.

## 5.2 `swing-guest` — one binary, Linux amd64

One executable with two roles:

- **coordinator** — singleton inside the VM. Speaks the wire protocol to
  `swing-server`. Spawns and supervises container children.
- **container** — the sandboxed child, run by bubblewrap as PID 1 inside a
  sandbox, which then serves exec/filesystem requests for that container.

Built for Linux amd64 only, always. Ships inside `base.img`.

**Fork safety:** do not `fork()` from an async runtime. The coordinator spawns
`bwrap … swing-guest container ...` via `std::process::Command` (posix_spawn/vfork);
bubblewrap performs the `unshare`/mount/`pivot_root` and exec's the child as PID 1 of
its own PID namespace. The container child is the security-critical code: keep it
small, single-threaded, boring.

## 5.3 The VM

"The VM" means the single long-lived outer QEMU virtual machine. Containers run
inside it. The VM never restarts in v1.

---

**Related:** [sandbox/vm.md](../sandbox/vm.md) (§14, the QEMU invocation) ·
[sandbox/containers.md](../sandbox/containers.md) (§11, what a container is) ·
[architecture/process-model.md](process-model.md) (§15, supervisor and channels) ·
[architecture/tickets.md](tickets.md) (§5.4–§5.6, the objects the server owns).
