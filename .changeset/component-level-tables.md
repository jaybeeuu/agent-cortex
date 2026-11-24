---
"@jaybeeuu/agent-cortex": minor
---

Every RICE component can now be pinned to its own level table. `## Reach levels`,
`## Confidence levels` and `## Effort levels` join `## Impact levels`, and all four read through
one table reader, so a fix to the reader reaches every component. Reach levels must be whole
numbers of zero or more, confidence levels more than 0 and at most 1, effort levels greater than
zero; `## Impact levels` keeps the name, shape and rule it shipped with.

`validate` reports every defect in every table the strategy carries, in one run, and the digest
prints each table beside the impact levels. `rice.mjs score` refuses a value that is not on its
component's table before the first `bd` call, names every allowed level and writes nothing; a
component with no table stays unconstrained, and `score` says which components those are. A bead
already carrying a value a table no longer lists is left alone: the tables gate new scores, never
stored ones.
