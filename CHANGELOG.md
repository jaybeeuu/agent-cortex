# Changelog

All notable changes to this repository are documented in this file.

## Unreleased

### Added

- Agent rule: maintain `CHANGELOG.md` and update it in the same commit as any repository change.
- New `technical-direction` skill for collaborative technical design: challenges assumptions, derives constraints from codebase context, evaluates alternatives (including autonomous web research when needed), and writes decision memos to `docs/technical-direction/`.
- New `agent-cortex:strategy` agent that creates top-level design documents across vision brief (`docs/strategy/`), PRD (`docs/prd/`), and technical direction, with evidence-backed tradeoffs before `ralph-plan`.

### Changed

- Feedback from failed review/verify/test-review stages is now written into a new chore bead's description rather than passed inline to the next agent prompt. Both the `run-beads` pipeline (ralph agent) and the `ralph` skill pipeline now create feedback beads on failure; the orchestrator sees them as ordinary ready beads and only needs to enforce loop caps before dispatching. The `fix` prompt templates (`run-beads/prompts/fixing.md` and `create-task/templates/fix.md`) now read required changes from `bd show <id>` rather than from injected REPORT content.



- Ralph now stores incidental orchestrator artifacts under `.agent-cortex/ralph/` (logs, progress snapshots, and state) instead of the repository root.
- Ralph, run-beads, and stage prompt templates now consistently point progress logging to `.agent-cortex/ralph/ralph-<bead-id>.log`.
- Git ignore guidance now standardizes on ignoring `.agent-cortex/` so incidental runtime files stay out of source control.
- Skills that generate non-repo working artifacts now target `.agent-cortex/ralph/` (plans, idea records, and ubiquitous-language glossary) instead of `.working-docs/` or `docs/`.
- `technical-direction` now requires a `References` section when external evidence informs decisions, including web URLs and code line-level references.
