# Tickets, attempts, sessions, containers

**Sections:** §5.4–§5.6 · **Read this if:** you want the object model and its state
machine — this is the heart of the design. · **Depends on:**
[components.md](components.md) (§5.1–§5.3) · **Decisions here:** D-10, D-11, D-16, D-17,
D-20, D-35 · **Open:** OQ-5, OQ-6, OQ-14

## 5.4 Ticket

The unit of work, the durable record, and the conversation surface between developer
and model. A user or a model session can open one.

```json
{
  "ticket": "T-42",
  "title": "count to ten",
  "goal": "Count from 1 to 10 and report the result.",
  "status": "open | running | blocked | parked | done | failed | deleted",
  "environment": { "packages": ["hello", "ripgrep"] },
  "workspace": "tickets/T-42",
  "blocked_on": ["T-41"],
  "attempts": ["A-101"],
  "entries": [
    { "seq": 1, "kind": "goal",     "from": "user",  "text": "..." },
    { "seq": 2, "kind": "model",    "from": "A-101", "text": "I'll run a shell command." },
    { "seq": 3, "kind": "tool_call","from": "A-101", "tool": "shell", "args": {"command":"seq 1 10"} },
    { "seq": 4, "kind": "tool_result","from":"A-101","call":"c-7","ok":true,"body":"1\n2\n...\n10\n" },
    { "seq": 5, "kind": "comment",  "from": "user",  "text": "good, now do 1..20" },
    { "seq": 6, "kind": "report",   "from": "A-101", "outcome": "done", "text": "counted to 10" }
  ],
  "published": { "result": "/nix/store/xxxx-thing" }
}
```

**Everything exchanged with the model is recorded**: prompts as assembled, model
text, tool calls, tool results. This is deliberately verbose — it is the debugging
tool. Summarization, collapsing, and pruning are a later context-management
milestone, not a reason to record less now.

**Human comments** are first-class entries. A ticket is the initial point of
conversation between developer and model: you can watch it, comment on it, and have
the next attempt see your comment.

`workspace` is a name inside the guest, not a host path.

| Status | Meaning |
|---|---|
| `open` | Unblocked, waiting for a scheduler slot. |
| `running` | Has a live attempt. |
| `blocked` | Waiting on tickets in `blocked_on`. |
| `parked` | Attempt ended deliberately; **container kept alive**, waiting for input. |
| `done` | Session filed a report; container kept until the ticket is deleted. |
| `failed` | Session errored, was cancelled, or hit an iteration limit; container kept until deleted. |
| `deleted` | Ticket deleted; container and workspace removed. |

## 5.5 Attempt, session, container

Three objects, and keeping them distinct matters:

- **Ticket** — durable, host-side, outlives everything.
- **Session** — one model conversation, host-side, in `swing-server`. Owns provider
  state, context assembly, tool dispatch.
- **Container** — one sandbox in the guest, with a workspace mount.

An **attempt** is one model session run against the ticket's container. A ticket
accumulates attempts and **reuses the same container across them**. At most one
attempt per ticket runs at a time.

## 5.6 Two lifetimes

The session is host-side and the container is guest-side, and they can fail
independently. This is a real state machine, not a detail:

| Event | Server action |
|---|---|
| Ticket first starts (first attempt begins) | `container.create` → `container.ready`; the container lives for the ticket's lifetime. |
| Session ends — `report`, iteration limit, or model error | Session ends; **container kept alive** for the ticket. Ticket → `done` or `failed`. |
| Session calls `park` (or model declares it blocked) | Session ends; **container kept alive**; ticket → `parked`, waiting for input. |
| Human comments on a `parked`/`done`/`failed` ticket | Ticket reopens to `open`; a new attempt (when scheduled) **reuses the same container and workspace**. |
| Container dies unexpectedly (OOM, crash) | Attempt fails with `container_lost`; restart the container or fail the attempt (decide: OQ-6). |
| Ticket deleted (`swing ticket delete`) | Container destroyed, workspace removed, uid released. |
| `swing down` | All containers torn down; workspaces lost (v1). |

**Prototype simplification.** Container lifetime is tied to the ticket's status:
created when the ticket first starts, kept across attempts and parking, destroyed only
on `swing ticket delete` (or VM stop). Idle containers are cheap, so we do not tear one
down every time the model pauses for input. *When* a `done`/`failed` container is
reclaimed before deletion is an open item (T6).

---

**Related:** [scheduler.md](scheduler.md) (§12) · [../data/storage.md](../data/storage.md)
(§9, where workspace bytes live) · [../interfaces/tool-protocol.md](../interfaces/tool-protocol.md)
(§6, terminal tools) · open items [OQ-5, OQ-6](../reference/open-questions.md) and
[T5, T6, T8](../../todo/tier1-a1.md).
