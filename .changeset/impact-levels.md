---
"@jaybeeuu/agent-cortex": patch
---

The prioritisation strategy gains an optional `## Impact levels` table: a two-column list of
labelled values, written by `init` and printed by `summary`. `score-bead`'s `score` refuses an
`--impact` figure the table does not list, naming every allowed level with its value and writing
nothing, so two scorers put the same bead on the same number. A strategy with no table is
unchanged: any impact of zero or more is accepted and the run says impact is unconstrained.
