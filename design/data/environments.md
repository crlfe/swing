# Environments

**Sections:** §8 · **Read this if:** you want to know what a container's software actually
is, and where it comes from. · **Depends on:** [../architecture/components.md](../architecture/components.md),
[../sandbox/containers.md](../sandbox/containers.md) (§11, the mount plan)
· **Decisions here:** D-12, D-13 · **Open:** OQ-4, OQ-12

**The ticket environment is a NixOS user environment.** The baseline toolset comes
from the base image's system-wide package set (`environment.systemPackages`), which
already provides `sh`, coreutils, and the basics the tool surface needs. A ticket's
`environment.packages` is layered on top as a `pkgs.buildEnv` derivation whose
closure becomes the container's mount plan.

- nixpkgs is pinned inside `base.img` via the flake. No channel fetch at runtime.
- The environment builder resolves the closure (`nix-store --query --requisites`)
  and produces the mount plan. This is where "the ticket describes the environment"
  becomes real.
- Containers get the baseline plus the ticket's closure, read-only. Nothing else.

**Consequence of no network:** new software can only arrive two ways — it was in
`base.img`, or `swing-server` pushed it in over the control channel. There is no
`nix-build` against a binary cache from inside the VM. See OQ-4; this is the largest
open design question.

---

**Related:** [../networking/networking.md](../networking/networking.md) (§10, why there is
no fetch) · [../networking/egress.md](../networking/egress.md) (§10a, why a tunnel is *not*
the answer) · [storage.md](storage.md) (§9, where the store lives) ·
[OQ-4](../reference/open-questions.md) worked as [T15, T16](../../todo/tier3-structural.md).
