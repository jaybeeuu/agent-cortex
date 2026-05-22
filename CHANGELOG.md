# Changelog

All notable changes to this repository are documented in this file.

## Unreleased

### Changed

- `record-idea` skill: idea files are now written to `docs/ideas/` instead of `.agent-cortex/ralph/ideas/` so they are tracked by git.

### Fixed

- `ralph` agent and skill: enforce foreground-only execution — ralph now warns and requests re-run if accidentally invoked as a background task.
- `ralph` agent: HITL Pause now kills any running poll-timer shell before stopping, so the timer can no longer fire and wake ralph up after it has paused. The action required per bead now explicitly instructs `bd close <id>` so it is clear what the human must do to unblock ralph.

### Added

- Agent rule: maintain `CHANGELOG.md` and update it in the same commit as any repository change.
- New `technical-direction` skill for collaborative technical design: challenges assumptions, derives constraints from codebase context, evaluates alternatives (including autonomous web research when needed), and writes decision memos to `docs/technical-direction/`.
- New `agent-cortex:strategy` agent that creates top-level design documents across vision brief (`docs/strategy/`), PRD (`docs/prd/`), and technical direction, with evidence-backed tradeoffs before `ralph-plan`.

### Added

- New `style-tests` skill

### Changed

- `ralph` agent and skill: when fully blocked on HITL gate beads (feature PR gates or epic PR gates) with no AFK work remaining, ralph now outputs a **Pending Human Action** summary table (bead ID, title, action needed, PR link) and stops — instead of idling the poll timer in a loop.
- `record-idea` skill: replaced validity-check interview questions with why/how/when/priority framing; updated template to match.
- Skills updated to use `.agent-cortex/ralph/`

- `ralph` agent (agents/ralph.agent.md) now uses a chore-bead-per-stage model consistent with `skills/ralph/`. Each pipeline stage creates its own chore bead on-demand; `stage:*` tags live on chore beads, not on the parent feature bead. `state.json` inflight entries now track `choreId`+`parentId` instead of a single `beadId`. Loop counts (TDD loops, fix rounds) are derived from `bd children` queries rather than counters in state.

 Both the `run-beads` pipeline (ralph agent) and the `ralph` skill pipeline now create feedback beads on failure; the orchestrator sees them as ordinary ready beads and only needs to enforce loop caps before dispatching. The `fix` prompt templates (`run-beads/prompts/fixing.md` and `create-task/templates/fix.md`) now read required changes from `bd show <id>` rather than from injected REPORT content.



- Ralph now stores incidental orchestrator artifacts under `.agent-cortex/ralph/` (logs, progress snapshots, and state) instead of the repository root.
- Ralph, run-beads, and stage prompt templates now consistently point progress logging to `.agent-cortex/ralph/ralph-<bead-id>.log`.
- Git ignore guidance now standardizes on ignoring `.agent-cortex/` so incidental runtime files stay out of source control.
- Skills that generate non-repo working artifacts now target `.agent-cortex/ralph/` (plans, idea records, and ubiquitous-language glossary) instead of `.working-docs/` or `docs/`.
- `technical-direction` now requires a `References` section when external evidence informs decisions, including web URLs and code line-level references.
