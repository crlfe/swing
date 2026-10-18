# Networking (v1)

**Sections:** §10 · **Read this if:** you want to know why there is no network, and what that
costs. · **Depends on:** [../overview.md](../overview.md) (principles 2 and 4)
· **Decisions here:** D-8, D-9, D-28 · **Open:** OQ-4, OQ-11, OQ-12

**There is none in v1.** No `-netdev`, no NIC device, no network configuration in the
guest, no network setup in containers. Our QEMU build compiles in no network backend
(see [§14](../sandbox/vm.md)).

- The guest's default namespace has only `lo`.
- Containers still get their own network namespace — not to block external access
  (there is none to block) but to prevent container↔container communication over
  `lo`. Cheap, and it keeps a door closed that we might otherwise open later.
- Every network-touching tool (`web_fetch`, `git_clone`, provider calls) is executed
  by `swing-server` on the host and its results are pushed in as frame bodies.

Consequences to accept:

- **Software supply is now a transfer problem**, not a fetch problem (OQ-4).
- **The GUI/demo milestone is now a bulk-stream problem.** With no NIC there is no
  VNC-over-TCP; display must be transported over the control channel (or a dedicated
  virtio-gpu + bulk stream). This makes the milestone harder and reinforces that it
  is load-bearing, not cosmetic.
- The guest clock cannot be synced from outside. Matters if anything in the guest
  ever needs TLS or timestamps.

This section describes **v1**. Planned mediated egress — which still involves **no NIC
and no QEMU netdev** — is specified in [§10a](egress.md).

---

**Related:** [egress.md](egress.md) (§10a) · [../data/environments.md](../data/environments.md)
(§8, supply) · [../sandbox/containers.md](../sandbox/containers.md) (§11, per-container netns)
· [../security/security-model.md](../security/security-model.md) (§13) ·
[T18](../../todo/tier3-structural.md) and [T24 … T24c](../../todo/tier4-product.md).
