---
"@jaybeeuu/agent-cortex": patch
---

A stop that needs a human decision becomes a bead, not a label: `bd-tool` and `AGENTS.md` now say
to create an `execution:hitl` task carrying the question, then make the waiting bead depend on it
with `bd dep add <waiting> <decision>`. The waiting bead leaves `bd ready` while the decision
becomes work a human can take, so one answer releases work that is already scoped. `--status
blocked` is kept for a stop no bead can carry, such as a fix-round cap, and `bd note` records the
stop and its reason.
