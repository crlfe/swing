# Process model and platform integration

**Sections:** §15 · **Read this if:** you want to know how the server runs, detaches, and
talks to QEMU, the CLI, and the browser on each platform. · **Depends on:**
[components.md](components.md) (§5.1), [../sandbox/vm.md](../sandbox/vm.md) (§14, the chardevs)
· **Decisions here:** D-4, D-19, D-24, D-27, D-44, D-45, D-46 · **Open:** OQ-13, OQ-15, OQ-22

The pattern — thin CLI controlling a long-lived per-user supervisor — is idiomatic on
all three platforms, but the *native* long-lived mechanisms differ and we deliberately
use none of them in v1:

| Platform | Native mechanism | Used by Swing? |
|---|---|---|
| Linux | systemd unit / `--user` unit | No (optional generated unit later) |
| macOS | launchd LaunchAgent / LaunchDaemon | No (optional registration later) |
| Windows | Windows Service via the SCM | **No** — needs admin, runs in session 0, cannot show UI |

A Windows service is the wrong shape for "runs as the developer's uid," and session-0
isolation would foreclose the GUI milestone. So: **a detached per-user process with a
pidfile and a private local control channel** (a Unix socket file on Linux/macOS, a named
pipe on Windows). The supervisor pattern needs no install step and works on all three
platforms, though the channel object is platform-native. Precedents: `wsl.exe` +
`LxssManager`, Docker Desktop, OrbStack.

Detaching details:

- Unix: `setsid`, ignore SIGHUP.
- Windows: `CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS | CREATE_NO_WINDOW`.
- **Job objects:** if the server puts QEMU in a Windows job object (a common cleanup
  idiom), QEMU dies with the server. Decide deliberately.
- Windows has no SIGHUP and no clean signal; shutdown is a control-channel message.
- IPC: **a private local channel everywhere except the browser surface.**
  - **server ↔ QEMU** — an inherited fd (`socketpair`, Unix) or a DACL-secured named pipe
    (Windows); QEMU is a child we spawn, so we hand it the descriptor / pipe handle.
  - **server ↔ CLI** — a *listening* Unix domain socket (Linux/macOS) or a named pipe whose
    DACL is scoped to the user's SID (Windows); the CLI is an independent process that
    connects later, so the server binds the socket file / creates the pipe. A socket file at
    `0600` or a DACL'd pipe means only this user's processes can connect — no handshake token
    needed on this channel.
  - **HTTP API / webapp** — **loopback TCP**, the *only* place a TCP server is used, because
    a browser cannot open a Unix socket or a named pipe. Token auth (OQ-13) stays here.

  Track A's server ↔ `swing-guest` link mirrors the Unix fd form (a `socketpair`) so the B2
  swap to virtio-serial stays a config change.
- Login-start registration (systemd user unit / LaunchAgent / Task Scheduler) is
  deferred to B5, but the server's design must tolerate being started by something
  other than the CLI.

---

**Related:** the chardev forms themselves are in [../sandbox/vm.md](../sandbox/vm.md)
(§14); the HTTP surface is [OQ-13](../reference/open-questions.md) and
[T23 / T23a](../../todo/tier4-product.md); crash semantics are
[OQ-15](../reference/open-questions.md) and [T8b](../../todo/tier1-a1.md); login-start is
[T27](../../todo/tier4-product.md).
