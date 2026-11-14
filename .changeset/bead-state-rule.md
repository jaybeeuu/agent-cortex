---
"@jaybeeuu/agent-cortex": minor
---

State the bead-state rule in `bd-tool` and `AGENTS.md`: operational state (progress, what a stage
learned, branch/PR/commit/worktree refs) lives in bead fields, while durable committable documents
stay files, and `handoff.md` plus the working-docs artefact directory are unchanged. `progress:` is
reserved for exceptions — `bd set-state <id> progress=blocked --reason "…"` records an event bead
and a label, so a cold agent can tell "stopped" from "never started" without reading prose. The
text names `stage=` as forbidden for state, with the reason: `bd set-state` removes the existing
label for the dimension it sets, so it would rewrite a chore's route.
