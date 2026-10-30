---
"@jaybeeuu/agent-cortex": patch
---

Fix `agent-cortex migrate` v1 reporting a half-migrated workspace as verified.

Detection and verification now read every bead from `bd export --all` and cross-check the
label index from `bd label list-all`, instead of querying `bd list --label-pattern`. On bd
1.3.1 a label-filtered `bd list` can omit closed beads, so 28 closed beads kept
`implementation-type:afk` while `--apply` printed `✓ v1 label-rename verified` and advanced
the workspace to v1. A legacy label that survives the apply now names the residual bead ids
and exits non-zero, and an export that cannot attribute a legacy label the index still lists
fails loudly instead of shrinking the result set.
