---
"@jaybeeuu/agent-cortex": minor
---

State the bead-state rule in `bd-tool` and `AGENTS.md`: operational state (progress, what a stage
learned, the decisions taken, branch/PR/commit/worktree refs) lives in bead fields, while durable
committable documents stay files, and `handoff.md` plus the working-docs artefact directory are
unchanged. The built-in statuses carry the working state — `bd statuses` lists all seven, so no
state label is added. What happened goes in the trail with `bd note`, which appends. The text names
`stage=` as forbidden for state, with the reason: `bd set-state` removes the existing label for the
dimension it sets, so it would rewrite a chore's route. Ship this in the same release as the
removal of the `ralph-*.log` and `progress.md` writer sites (`agnt-ctx-ul91.1`): a published
version that states the rule while a skill still writes progress files would contradict itself.
