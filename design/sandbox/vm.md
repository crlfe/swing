# The VM — QEMU configuration and portability

**Sections:** §14 · **Read this if:** you are building or launching QEMU, or checking the
portability claim. · **Depends on:** [../architecture/components.md](../architecture/components.md)
(§5.3), [../architecture/process-model.md](../architecture/process-model.md) (§15)
· **Decisions here:** D-2, D-3, D-24, D-28, D-29, D-30, D-31, D-44, D-45 · **Open:** OQ-9, OQ-10, OQ-22

Portable base — note the absence of any `-netdev`:

```
qemu-system-x86_64 \
  -machine q35 -m 4096 -smp 4 \
  -nodefaults -no-reboot -no-shutdown -display none \
  -rtc base=utc,clock=rt \
  -drive if=none,id=base,file=base.img,read-only=on  -device virtio-blk-pci,drive=base
  -drive if=none,id=sys,file=system.qcow2            -device virtio-blk-pci,drive=sys
  -drive if=none,id=scr,file=scratch.qcow2           -device virtio-blk-pci,drive=scr
  -device virtio-serial-pci \
  -chardev <ctrl-chardev> \
  -chardev <bulk-chardev> \
  -device virtserialport,chardev=ctrl,name=control0 \
  -device virtserialport,chardev=bulk,name=bulk0 \
  -accel <platform> -cpu <platform>
```

No network device at all. No USB, no sound, no VGA, no IDE, no PCI hotplug, no
`-serial`, no `-cdrom`, no `-balloon`.

**The control channel is a private local channel, not a network port.** The server creates
the channel and hands QEMU one end; QEMU never binds a listener and never opens a network
socket. The transport is platform-native because the two native forms give the same
capability-boundary property, and both are strictly stronger than a loopback port:

- **Linux / macOS:** a `socketpair()`; one descriptor is passed to QEMU as
  `-chardev socket,fd=N` (`<ctrl-chardev>` / `<bulk-chardev>` above), the server keeps the
  peer. No port, no listener.
- **Windows:** a named pipe whose DACL grants access only to QEMU's restricted token
  (`CreateRestrictedToken`), handed to QEMU as a named-pipe chardev. The DACL *is* the
  capability boundary.

This replaces the earlier loopback-TCP-everywhere decision (D-19, D-27, now revised): the
Windows named-pipe + DACL + restricted-token mechanism is close enough to Unix fd-passing
that the consistency argument no longer justifies a network port for the QEMU channel. The
channel object — an fd or a pipe handle — *is* the capability, so the QEMU channel needs no
handshake token, binds no port, cannot be reached by any other local process, and produces
no firewall prompt on Windows. The exact chardev spelling per platform is confirmed in the
T13a spike (OQ-22).

**Build guarantee:** our QEMU build compiles in **no network backend** — no libslirp,
no `virtio-net`, no `passt`. "The VM has no network device" is then a build-time
property rather than a config-time one, and a flag typo cannot reintroduce it. If
mediated egress ever needs a backend, that guarantee is walked back deliberately. There is
**no loopback-TCP fallback for the control channel**: if the platform-native channel cannot
be established with the full `-sandbox` / restricted-token grant, Swing fails with a clear
error rather than falling back to a TCP transport that would re-grant QEMU a socket
capability (D-45).

| Option | Linux | macOS | Windows |
|---|---|---|---|
| `-machine q35`, virtio-blk / virtio-serial | ✔ | ✔ | ✔ |
| `-display none`, `-nodefaults`, `-no-reboot`, `-no-shutdown` | ✔ | ✔ | ✔ |
| `-chardev socket,fd=N` (inherited fd) | ✔ — **used** | ✔ — **used** | ✘ — no fd inheritance |
| `-chardev` named pipe (`pipe`) | ✔ | ✔ | ✔ — **used**, DACL-secured |
| `-chardev socket` on 127.0.0.1 | ✔ | ✔ | ✔ — **not used** (old transport) |
| `-chardev socket` AF_UNIX | ✔ | ✔ | ✘ — not used |
| `-netdev user` (slirp) | ✔ | ✔ | ✔ — **not compiled into our build** |
| `-netdev passt` | ✔ | ✘ | ✘ — **not used, not portable** |
| `-netdev dgram` | ✔ | ✔ | ✔ — **not used**, see §10a |
| `-accel kvm` | ✔ | — | — |
| `-accel hvf` | — | ✔ | — |
| `-accel whpx` | — | — | ✔ (needs Windows Hypervisor Platform) |
| `-accel tcg` (fallback) | ✔ | ✔ | ✔ |
| `-cpu host` | ✔ | ✔ | ⚠ with whpx; ✘ with tcg |
| `-sandbox on,...` | ✔ | ✘ | ✘ |

Notes:

- **Acceleration is the portability risk, not the device model.** `whpx` needs the
  Windows Hypervisor Platform; nested virtualization is unavailable on many cloud
  VMs. TCG fallback is correct but 10–50× slower — treat "no hardware acceleration"
  as unsupported with a clear error, not as a slow path.
- On non-`host` CPUs, pin a named model so guest binaries match what `base.img` was
  compiled for. This constrains the flake's `nixpkgs.hostPlatform`.
- `-sandbox on` is Linux-only; no security property in this design may depend on it.
  With no network backend compiled in **and the control channel now an inherited fd rather
  than a TCP connection**, the sandbox grant QEMU needs is essentially file read/write plus
  the two channel descriptors — QEMU is granted **no socket-creation capability** (no
  `socket`/`bind`/`listen`/`connect` syscalls; the channel is a pre-connected fd it only
  reads and writes, which is why the AF_UNIX chardev row above is marked "not used"). On
  Windows the restricted token is scoped the same way: file access plus the named-pipe handle.
- QEMU ships in the artifact bundle per platform, never found on `PATH`.

---

**Related:** the rejected network backends are argued in
[../networking/egress.md](../networking/egress.md) (§10a) · the images attached above are
[../data/storage.md](../data/storage.md) (§9) · spikes: [T10, T11, T13, T13a, T14](../../todo/tier2-b1.md) ·
open: [OQ-9, OQ-10, OQ-22](../reference/open-questions.md).
