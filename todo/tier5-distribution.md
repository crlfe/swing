# Tier 5 — image distribution (B7), treat as a security review item

**Items:** T30 · **Read this if:** you are designing how the base image reaches users — this
is the new supply-chain front door. · **Design sections:**
[§16a](../design/data/packaging.md), [§13](../design/security/security-model.md)
· **Open questions:** OQ-19

### T30. Update mechanism design  *(OQ-19)*
Signed manifest + content-defined chunking + resume + delta + verify-then-swap +
rollback is the chosen shape (D-37). Decide:

- **Where images and chunks are hosted**, and the chunk store layout.
- **CDC tooling**: the `casync` family vs. `xdelta3`/bsdiff. Preference for CDC for
  disk images; confirm the Rust story (is there a maintained CDC implementation, or do
  we shell out, or do we use a simpler fixed-block scheme with a content index?).
- **Signing key custody and rotation.** Who holds it, how a key is retired, what a
  client does on signature failure, how a bad release is revoked.
- **What the manifest pins**: image hash, `swing` version range, `swing-guest` version,
  QEMU version. This manifest is what makes D-15 workable over a network.
- **Resume semantics**: at chunk granularity via HTTP range requests, not one blob.
- **Cache layout** keyed by content hash, and its GC policy.
- **Offline fallback**: a bundled image, or a "copy the cache directory" path. First
  run now requires host network; state the air-gapped story even if it is low priority.
- **Rollback and bricking**: what happens if a delta is applied and the new image is
  broken.

**Treat the download endpoint, the signing key, and the delta-application path as
supply-chain components equal in trust to the flake build.** A compromised delta
compromises the VM image for every user.

---

**Previous:** [tier4-product.md](tier4-product.md). **Also read:**
[design/security/accepted-risks.md](../design/security/accepted-risks.md) — "the update
channel is the new supply-chain front door".
