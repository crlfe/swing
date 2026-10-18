# Tier 3 — structural, decide before they harden

**Items:** T15 … T22 · **Read this if:** you want the questions that change the shape of the
system, and that get much more expensive once code exists. · **Design sections:**
[§8](../design/data/environments.md), [§10](../design/networking/networking.md),
[§12](../design/architecture/scheduler.md), [§13](../design/security/security-model.md)
· **Open questions:** OQ-4, OQ-11, OQ-12, OQ-14

### T15. Software supply with no network  *(OQ-4)*
**The largest open structural question.** With no NIC in the VM, new software arrives
only from `base.img` or via server-pushed transfer.

Options:
- (a) Everything from `base.img`; "request additional software" deferred.
- (b) Server implements enough of the Nix HTTP binary-cache protocol to fetch
  `.narinfo`/`.nar`, verify signatures host-side, and stream closures into the guest
  store.
- (c) Guest store fixed; tickets choose only from what is present.

**Constraint now recorded (D-33):** supply must be an explicit, recorded, verified
fetch. It must **not** be solved by giving containers a network tunnel, because a
transparent tunnel makes dependency trees unverifiable and unreproducible and would
let dependency supply inherit the runtime egress policy.

Related: where signature verification happens if the server fetches; whether
agent-built derivations are visible to other tickets before explicit publish; how big
a pushed closure can get over the bulk stream.

### T16. Baseline environment contents
Decide the exact `environment.systemPackages` set in the flake. With a 1 GB budget it
can be generous — `sh`, coreutils, `grep`, `sed`, a diff, `git`, maybe a compiler
toolchain — but confirm what actually belongs in the baseline versus what tickets must
request. Also decide whether the baseline is versioned independently of ticket
environments.

### T17. Prompt injection and network tools  *(new)*
`swing-server` now executes network tools on the model's behalf. A prompt-injection
attack that persuades a session to call `web_fetch` against an attacker endpoint is a
host-side risk with no VM boundary involved.

Decide before any network tool ships:
- Allowlist vs. deny-by-default vs. per-ticket grants.
- Whether fetched content is marked as untrusted when it enters the transcript.
- Whether `git_clone` is allowed at all in v1.
- That mediated egress (T24) **enlarges** this risk: any code in a container,
  including a malicious dependency, can open connections subject to an L4 filter.

### T18. GUI/demo transport  *(OQ-11)*
No NIC means no VNC-over-TCP, and the two obvious escapes were rejected: passt (not
portable, D-30) and `-netdev dgram` (packet pipe, D-31). Options remaining: virtio-gpu
+ screenshots over the bulk stream; a Wayland socket proxied over a virtio-serial
chardev; SPICE over a chardev.

Also decide now, even though the milestone is late:
- Commit to a headless VM with no local display device.
- The GUI milestone introduces a **human → container input channel**, a new trust
  boundary. Write it down so nobody assumes the boundary is one-directional.

### T19. How a developer consumes an output  *(OQ-12)*
Host has no Nix; VM has no network. "Publish a nix package" is well-defined inside the
VM; delivery to plain Windows or macOS is unresolved. Options: run it in the VM and
expose the result (ties to T18); export a portable bundle; export the closure for
archival only.

Likely answer is "execution stays in the VM, export is for inspection," which makes
T18 load-bearing rather than cosmetic. Needs an answer before B4.

### T20. Transcript growth and context management  *(OQ-14)*
Recording everything means tickets can reach hundreds of megabytes.

Decide: per-entry size caps; whether large tool results are stored as external blobs
referenced by the entry; when the ticket stops being a readable document; and the
summarize/collapse/prune strategy for context (B3).

### T21. Secrets beyond LLM keys
GitHub tokens, database URLs, API keys for services under test. Decide whether the
server is the only secrets broker, whether per-ticket scoped grants are possible, and
what the ticket records about which secrets an attempt had access to.

### T22. Scheduler semantics under real tickets
- Failure propagation: does a failed child fail the parent or just block it.
- Retry policy: none in v1 — confirm acceptable.
- Parking triggers: model-declared only, or also silence/timeout detection.
- Ticket tree depth limits; total-ticket caps per session.
- Tickets blocked on tickets that get abandoned.

---

**Next tier:** [tier4-product.md](tier4-product.md). **Previous:** [tier2-b1.md](tier2-b1.md).
