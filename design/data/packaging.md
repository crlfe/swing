# Packaging, image distribution, size budget

**Sections:** §16, §16a, §16b · **Read this if:** you want to know what ships, how the base
image gets to a user, and what it is allowed to weigh. **§16a is a security section, not a
packaging section** — read it with [../security/security-model.md](../security/security-model.md).
· **Depends on:** [storage.md](storage.md) (§9) · **Decisions here:** D-13, D-23, D-36, D-37
· **Open:** OQ-9, OQ-10, OQ-19

## 16. Packaging and image build

- **`base.img` is built by a nix flake** — pinned nixpkgs, reproducible, hashed,
  versioned. The flake is the supply-chain control point.
- Prototype distribution: one `tar.zst` containing the `swing` binary, the QEMU
  binaries, and the three disk images. No installer, no self-extraction. **This is a
  prototype convenience, not the shipping plan** — see §16a.
- Later: a single self-contained statically-linked binary — Rust with
  `x86_64-unknown-linux-musl` for Linux. "Self-contained" is a packaging problem, not
  a language problem — QEMU is a subprocess. **The base image is not embedded in the
  binary**; it is fetched separately (see §16a). Embedding a ~1 GB image would just be
  shipping a large archive, which §16a is designed to avoid.

## 16a. Image distribution and updates

Pre-ship goal: **the daemon downloads the base image**, with resume and binary-diff
updates, rather than shipping a large archive for users to download — and it
periodically re-fetches so the guest picks up security fixes. The early prototype
skips this and ships a single `tar.zst` bundle (see §16).

Shape:

- **Signed manifest** pins the exact image hash and the `swing` ↔ `base.img` ↔
  `swing-guest` triple. This is what makes D-15 ("no protocol negotiation") workable
  over a network: the manifest *is* the pin.
- **Content-defined chunking** for deltas — the `casync` family, or `xdelta3` /
  bsdiff against the previous image. CDC is preferred for disk images: it dedupes
  across versions, tolerates byte reordering, and does not degrade when a rebuild
  shifts bytes early in the file the way plain bdiff does.
- **Resume at chunk granularity**, via HTTP range requests against a chunk store, not
  against one large blob. Resume is far more robust when the unit is a chunk.
- **Verify-then-swap:** fetch chunks → assemble → verify against the manifest → atomic
  rename → retain the previous image for rollback.
- **Cache keyed by content hash**, so versions share chunks and a state directory does
  not grow linearly.
- The read-only, immutable `base.img` is unusually well suited to this: it is
  content-addressed, so cross-version dedupe is natural.

Two things to treat as first-class:

1. **This is a supply-chain surface, and it is the one that matters most.** The
   download endpoint, the signing key, and the delta-application path become as
   trusted as the flake build. A compromised delta compromises the VM image for every
   user. It gets its own section in the security review, not a line under packaging.
2. **Offline becomes a mode to design for.** First run now requires host network. A
   bundled fallback image, or a "copy the cache directory" path, should be stated even
   if it is low priority.

## 16b. Image size budget

**Under 1 GB is acceptable.** That settles the size half of a three-way coupling
(image size / guest init / baseline packages) and makes **keeping systemd in the guest
the default** rather than the expensive option — which buys supervision, journald, and
`systemd-run --scope` for cgroups, i.e. real code we do not have to write.

Size and boot **time** are separate budgets. systemd costs time, not only bytes, so
the open question is now "what is the boot time," not "can we afford systemd." See
OQ-9 and OQ-10.

---

**Related:** [../security/security-model.md](../security/security-model.md) (§13, supply
chain) · [../security/accepted-risks.md](../security/accepted-risks.md) (the update channel
as the new front door) · [../sandbox/vm.md](../sandbox/vm.md) (§14, what is in the bundle) ·
[T25, T30](../../todo/tier5-distribution.md) · [OQ-19](../reference/open-questions.md).
