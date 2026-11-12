---
"@jaybeeuu/agent-cortex": patch
---

Chunk the `migrate` v1 label rename: each `bd label add` and `bd label remove` call
now carries at most 20 bead ids. One call carrying every id in a large workspace
applied only part of the list and still reported success, so v1 never converged and a
workspace could report itself migrated with hundreds of legacy labels attached.
