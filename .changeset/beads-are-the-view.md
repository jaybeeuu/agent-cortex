---
"@jaybeeuu/agent-cortex": patch
---

Delete the generated `.agent-cortex/ralph/progress.md` view and its renderer. Beads are the
view: ralph now reports status straight from `bd list --parent <id>`, `bd ready`, and `bd show`,
and the ralph skill documents those commands for humans instead of a regeneration step. Removes
`generate-progress.ts`, its test, the `skills/workflow/run-pipeline-stage/scripts` workspace that
existed only to run them, and every regeneration instruction in the ralph agent, `ralph` skill,
`run-pipeline-stage` skill, and the Copilot poll tick.
