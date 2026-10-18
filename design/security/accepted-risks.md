# Accepted risks

**Sections:** — (was the "Watch list" in `todo.md`) · **Read this if:** you want to know what
is knowingly *not* solved, so nobody reports it as news. · **Depends on:**
[security-model.md](security-model.md) (§13), [../roadmap/milestones.md](../roadmap/milestones.md)
· **Decisions here:** — · **Open:** OQ-9, OQ-14, OQ-18, OQ-19, OQ-20, OQ-21, OQ-22

These are **accepted risks, not decisions**. Each is stated so it is not rediscovered as a
surprise. None of them is unsolved by accident.

- **Track A becoming the product.** `unshare` protects the host's files; it is not a
  kernel boundary, it requires host user namespaces, and it does nothing on Windows.
  The security story is incomplete until Track B lands.
- **QEMU is the security boundary**, so we inherit its device-model CVE history.
  Mitigated by device minimization, no network backend compiled in, and Linux
  `-sandbox on`; not solved.
- **The control-channel transport is now per-platform and asserted, not proven** (T13a,
  T23a, OQ-22). Two implementations (fd-passing / Unix socket on Unix, named pipe + DACL on
  Windows) replace the single loopback path for both the QEMU and CLI channels; the Windows
  mechanism in particular is unverified. There is **no loopback-TCP fallback**: if the
  platform-native channel cannot be established with the full `-sandbox` / restricted-token
  grant, Swing fails with a clear error rather than falling back to a TCP transport that
  would re-grant QEMU a socket capability (D-45).
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
  load-bearing claim in [§10a](../networking/egress.md) of the design. Spike it before
  designing the policy layer.
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

---

**Related:** [security-model.md](security-model.md) §13 "Known weak points" is the
boundary-by-boundary version of this list; the standing Track A constraint is in
[../roadmap/milestones.md](../roadmap/milestones.md).
