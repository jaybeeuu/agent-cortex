---
"@jaybeeuu/agent-cortex": minor
---

`skills/workflow/ralph/scripts/idle-check.mjs` is the command a watch polls to answer two questions
in one pass: which `execution:afk` beads are ready, and which in-progress beads have gone quiet. It
prints one JSON object with `ready` (id and priority) and `stalled` (id, status, quiet minutes and
reason) arrays, both sorted by id, so a reordering is not a change and a tick makes no model call.

A bead is stalled when it is `in_progress` and its last sign of life — heartbeat, claim, its own
row, its creation, or the newest trail entry in its notes — is older than the threshold, which
defaults to **5 minutes** and is set by `--stall-minutes` or `AGENT_CORTEX_IDLE_STALL_MINUTES`. Five
rather than thirty because a worker silent for longer than a few minutes is more likely dead than
busy. An expired lease is reported immediately with its own reason, whatever the bead's age.

Exit `0` printed a digest, `1` could not read the tracker and printed nothing — so a watch stays
silent rather than nudging ralph to look at nothing — and `2` was given unusable arguments. The
script is read-only, async only, and documented in ralph's `REFERENCE.md` under _Idle Check_.
