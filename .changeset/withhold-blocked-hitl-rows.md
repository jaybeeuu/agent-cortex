---
"@jaybeeuu/agent-cortex": minor
---

Withhold a HITL row an open bead blocks. `hitl-queue` ranked every open `execution:hitl` bead on
its full score and counted dependencies upward only, so a gate waiting on its own open stage could
take first place — and `recommend` would then name a bead nobody can answer yet.

The queue now reads `bd dep list <id> --direction down` for each scored candidate. A row held by an
open `blocks` dependency is left out of the ranking, counted on the `excluded:` line and published
in `--json` as `counts.withheldBlocked` and one `withheld[]` row per bead, each with the
`blockedBy` ids that hold it. Only the downward `blocks` edge withholds: a
`parent-child` edge is ownership, and a closed blocker leaves the row ranked exactly as before.
`recommend` gains one stated condition, `nothing is answerable yet`, and names a blocked bead as
held rather than printing it as the answer.
