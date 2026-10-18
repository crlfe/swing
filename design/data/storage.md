# Storage

**Sections:** §9 · **Read this if:** you want to know what is on disk, who owns it, and how
long a workspace survives. · **Depends on:** [../architecture/tickets.md](../architecture/tickets.md)
(§5.4 `workspace`, §5.6 lifetimes) · **Decisions here:** D-17, D-18, D-35 · **Open:** OQ-8

Three image files, owned by `swing-server`, mode 0600, under a per-project state
directory. The host never mounts any of them.

| File | Lifetime | Contents |
|---|---|---|
| `base.img` | Immutable, versioned, built by the flake | Minimal NixOS + `swing-guest` + pinned nixpkgs + baseline packages. Attached read-only. |
| `system.qcow2` | Persistent across server restarts | Writable overlay above the base; `/nix/store` additions; published derivations. |
| `scratch.qcow2` | **Wiped on every VM start** | Container workspaces. Pure scratch. |

`/nix/store` in the guest is an **overlayfs** of the read-only base store (lower) and
a writable upper layer on `system.qcow2`. "Reset the system" = delete the upper
layer. See OQ-8 — the riskiest unvalidated assumption in this document.

**Workspace lifetime.** The server records a workspace name per ticket; the bytes
live on `scratch.qcow2`. A workspace (and its container) lives for the ticket's
lifetime — across attempts and parking — and is removed only when the ticket is
deleted. Because v1 never restarts the VM, this also spans the whole VM session. If
the server shuts the VM down, workspaces are gone and a parked ticket resumes as a
new attempt from its transcript.

---

**Related:** the overlay assumption is spiked as [T9](../../todo/tier2-b1.md) (OQ-8);
the images are attached by [../sandbox/vm.md](../sandbox/vm.md) (§14); `base.img` is
built and distributed per [packaging.md](packaging.md) (§16, §16a).
