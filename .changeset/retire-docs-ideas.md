---
"@jaybeeuu/agent-cortex": patch
---

Retire `docs/ideas/` now that ideas are `kind:idea` beads. The four remaining idea files that had
never been migrated were recorded as beads, and the directory was deleted, so ideas have a single
home. Live references to the deleted paths now cite the originating bead instead; `agent-cortex
migrate` step v2 still reads `docs/ideas/` as a migration source, which is unchanged.
