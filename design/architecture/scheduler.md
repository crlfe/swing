# Scheduler

**Sections:** §12 · **Read this if:** you want to know how tickets get run.
· **Depends on:** [tickets.md](tickets.md) (§5.4 `blocked_on`, §5.6 lifetimes)
· **Decisions here:** — · **Open:** OQ-5

Server-side. Deliberately dumb in v1.

- A ticket is **schedulable** if it is `open` and every ticket in `blocked_on` is
  `done`.
- At most N (constant, 2–4) attempts running.
- On attempt completion, re-evaluate and fill slots.
- Cycle detection at ticket creation.
- A failed child leaves its parents blocked; a human decides what happens next. No
  automatic retry in v1.

---

**Related:** [tickets.md](tickets.md) · semantics under real tickets are tracked as
[T22](../../todo/tier3-structural.md).
