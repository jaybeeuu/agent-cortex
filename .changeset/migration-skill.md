---
"@jaybeeuu/agent-cortex": minor
---

Add the `migration` skill (`skills/productivity/migration/`). It documents how any workspace
runs the versioned `agent-cortex migrate` command to move from `implementation-type:afk|hitl` to
`execution:afk|hitl`: preflight and current-version detection, a pre-migration export snapshot, a
gated dry-run review, `--apply` with batched add-then-remove label writes, the four post-checks
(`bd label list-all` clean, the `bd list --label-pattern` group empty, the `bd ready -l
execution:afk` smoke, the stale-reference sweep), and an idempotence re-run. `REFERENCE.md`
records the command interface the skill depends on, the v1 label-rename and v2 idea-file steps,
rollback recipes, and the manual fallback for pinned versions. The two-axis model (bead type ×
execution) is stated as the rationale, including why a half-migrated workspace silently starves
ralph's queue.

The skill sets `disable-model-invocation: true`, so it is reachable only through its explicit
command and never auto-routed from a description match — `--apply` renames labels across a whole
workspace, which is not something a fuzzy match should be able to trigger. On Claude Code and pi
that hides the skill from automatic selection while `/skill-name` still works; on Copilot CLI the
field suppresses auto-routing *and* model-mediated invocation, leaving only the interactive
`/migration` slash command (see `docs/research/disable-model-invocation.md`).
