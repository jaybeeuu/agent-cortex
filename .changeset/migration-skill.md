---
"@jaybeeuu/agent-cortex": minor
---

Add the `migration` skill (`skills/productivity/migration/`). It documents how any workspace
runs the versioned `agent-cortex migrate` command to move from `implementation-type:afk|hitl` to
`execution:afk|hitl`: preflight and current-version detection, a pre-migration export snapshot, a
gated dry-run review, `--apply` with batched add-then-remove label writes, the four post-checks
(empty old-label space, `bd ready -l execution:afk` smoke, stale-reference sweep), and an
idempotence re-run. `REFERENCE.md` records the command interface the skill depends on, the v1
label-rename and v2 idea-file steps, rollback recipes, and the manual fallback for pinned
versions. The two-axis model (bead type × execution) is stated as the rationale, including why a
half-migrated workspace silently starves ralph's queue.
