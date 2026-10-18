# Swing — Design

**Swing** (as in "take a swing at it").

Status: draft v6, pre-prototype. The design is split by subsystem so you can read the
overview, or one part of the system, without reading all of it.

- Resolved items are in [Decisions](reference/decisions.md) (D-1 … D-46).
- Unresolved items are in [Open Questions](reference/open-questions.md) (OQ-1 … OQ-22)
  and [`todo/`](../todo/).

---

## How to read this

| If you want | Read |
|---|---|
| **5 minutes — what is this at all** | [overview.md](overview.md) |
| **30 minutes — is the design sane** | [overview](overview.md) → [tickets](architecture/tickets.md) → [security model](security/security-model.md) → [milestones](roadmap/milestones.md) |
| **30 minutes — is it buildable** | [overview](overview.md) → [the VM](sandbox/vm.md) → [containers](sandbox/containers.md) → [storage](data/storage.md) |
| **Implementing today** | [todo/first-step.md](../todo/first-step.md) → [tool protocol](interfaces/tool-protocol.md) → [wire protocol](interfaces/wire-protocol.md) → [containers](sandbox/containers.md) |
| **Security review** | [security model](security/security-model.md) → [accepted risks](security/accepted-risks.md) → [egress](networking/egress.md) → [packaging](data/packaging.md) |
| **Every decision, and why** | [reference/decisions.md](reference/decisions.md) |
| **What is still undecided** | [reference/open-questions.md](reference/open-questions.md) |

## Files

```
design/
  README.md                    # this file: index, section map, conventions
  overview.md                  # §1–§4, the §5 component map, §18 worked example, §19 naming
  architecture/
    components.md              # §5.1–§5.3  swing / swing-server / swing-guest / the VM
    tickets.md                 # §5.4–§5.6  ticket, attempt/session/container, lifetimes
    scheduler.md               # §12
    process-model.md           # §15  process model + platform integration
  interfaces/
    tool-protocol.md           # §6
    wire-protocol.md           # §7
  sandbox/
    vm.md                      # §14  QEMU configuration and portability
    containers.md              # §11  bubblewrap, cgroups, uid allocation
  data/
    environments.md            # §8   Nix environments
    storage.md                 # §9   the three images, workspace lifetime
    packaging.md               # §16, §16a, §16b  packaging / distribution / size budget
  networking/
    networking.md              # §10  v1: there is none
    egress.md                  # §10a mediated egress (planned, not v1)
  security/
    security-model.md          # §13
    accepted-risks.md          # accepted risks (was the todo "Watch list")
  roadmap/
    milestones.md              # §17  two tracks + combined roadmap
  reference/
    decisions.md               # §20  D-1 … D-46
    open-questions.md          # §21  OQ-1 … OQ-22

todo/
  README.md                    # status snapshot, tier index, T → OQ → § traceability
  first-step.md                # the smallest useful spike + decide-in-the-first-week
  tier1-a1.md                  # T1 … T8b   blocks A1
  tier2-b1.md                  # T9 … T14   blocks B1
  tier3-structural.md          # T15 … T22  structural
  tier4-product.md             # T23 … T29  shapes the product
  tier5-distribution.md        # T30        image distribution (B7)
```

## Section map

The `§` numbers are the stable identifiers for the design. They are used throughout the
codebase — source comments, `schema.toml`, commit messages — and they are **preserved
across this split**. A reference to `§7` means the wire protocol, wherever it lives.

| § | Section | File |
|---|---|---|
| §1–§4 | What this is / goals / non-goals / core principles | [overview.md](overview.md) |
| §5 | Components — the map | [overview.md](overview.md) |
| §5.1–§5.3 | `swing` and `swing-server`, `swing-guest`, the VM | [architecture/components.md](architecture/components.md) |
| §5.4–§5.6 | Ticket, attempt/session/container, two lifetimes | [architecture/tickets.md](architecture/tickets.md) |
| §6 | Tool protocol | [interfaces/tool-protocol.md](interfaces/tool-protocol.md) |
| §7 | Wire protocol | [interfaces/wire-protocol.md](interfaces/wire-protocol.md) |
| §8 | Environments | [data/environments.md](data/environments.md) |
| §9 | Storage | [data/storage.md](data/storage.md) |
| §10 | Networking (v1) | [networking/networking.md](networking/networking.md) |
| §10a | Mediated egress (planned, not v1) | [networking/egress.md](networking/egress.md) |
| §11 | Containers | [sandbox/containers.md](sandbox/containers.md) |
| §12 | Scheduler | [architecture/scheduler.md](architecture/scheduler.md) |
| §13 | Security model | [security/security-model.md](security/security-model.md) |
| §14 | QEMU configuration and portability | [sandbox/vm.md](sandbox/vm.md) |
| §15 | Process model and platform integration | [architecture/process-model.md](architecture/process-model.md) |
| §16 / §16a / §16b | Packaging / image distribution / size budget | [data/packaging.md](data/packaging.md) |
| §17 | Milestones — two tracks | [roadmap/milestones.md](roadmap/milestones.md) |
| §18 | Worked example | [overview.md](overview.md) |
| §19 | Naming | [overview.md](overview.md) |
| §20 | Decisions | [reference/decisions.md](reference/decisions.md) |
| §21 | Open questions | [reference/open-questions.md](reference/open-questions.md) |
| — | Accepted risks | [security/accepted-risks.md](security/accepted-risks.md) |

## Conventions

- **IDs are the spine, not paths.** `D-nn` (decision), `OQ-nn` (open question),
  `T-nn` (todo), `§n` (design section). They are globally unique and never reused.
  File paths move; IDs do not. Cite IDs.
- **`§` numbers are inherited from the single-document version** and are kept as the
  heading of every section, even where a file starts mid-numbering. Resolve them with
  the map above.
- **Every file opens with a header line**: sections covered, "read this if", what it
  depends on, and the decisions and open questions that live in it. That header is what
  makes this index cheap to keep current.
- **Registers stay single files on purpose.** [decisions.md](reference/decisions.md) and
  [open-questions.md](reference/open-questions.md) are valuable precisely because they
  are scannable in one pass. If either passes ~300 lines, split by area mirroring these
  subdirectories, and keep the register index intact.
- **One source of truth per kind of statement.** *What the milestones are* lives in
  [roadmap/milestones.md](roadmap/milestones.md). *What is done today* lives in
  [todo/README.md](../todo/README.md). *What is accepted but not solved* lives in
  [security/accepted-risks.md](security/accepted-risks.md).
