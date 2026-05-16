# Changelog

All notable changes to this repository are documented in this file.

**Note:** Every commit to `main` is a release. Add entries to the appropriate version section in
the same commit as the change. When bumping `plugin.json` version, create a new section header
with that version and today's date.

## [0.35.6] - 2026-05-16

### Changed
- Consolidate stage outcome format to unified `OUTCOME: SUCCESS|BLOCKED` pattern with `BLOCKING_ISSUES` list. Simplifies orchestrator logic — all stages now report identical outcome field.

## [0.35.5] - 2026-05-15

### Changed
- Move stage policy from scattered prompt files to reusable playbooks (`skills/run-beads/playbooks/<stage>.md`). Beads now treated as pure specifications; orchestration policy lives in playbooks.
- Consolidate seven stage-specific prompts into single universal runner (`stage-runner.md`).
- Simplify Ralph scheduling to rely purely on `bd ready --assignee Agent` output; remove extra PR-gate pause logic.

## Unreleased

(No unreleased changes. Update this section when starting new work.)
- New `agent-cortex:strategy` agent that creates top-level design documents across vision brief (`docs/strategy/`), PRD (`docs/prd/`), and technical direction, with evidence-backed tradeoffs before `ralph-plan`.

### Added

- New `style-tests` skill

### Changed

- `record-idea` skill: replaced validity-check interview questions with why/how/when/priority framing; updated template to match.
- Skills updated to use `.agent-cortex/ralph/`

- `ralph` agent (agents/ralph.agent.md) now uses a chore-bead-per-stage model consistent with `skills/ralph/`. Each pipeline stage creates its own chore bead on-demand; `stage:*` tags live on chore beads, not on the parent feature bead. `state.json` inflight entries now track `choreId`+`parentId` instead of a single `beadId`. Loop counts (TDD loops, fix rounds) are derived from `bd children` queries rather than counters in state.

 Both the `run-beads` pipeline (ralph agent) and the `ralph` skill pipeline now create feedback beads on failure; the orchestrator sees them as ordinary ready beads and only needs to enforce loop caps before dispatching. The `fix` prompt templates (`run-beads/prompts/fixing.md` and `create-task/templates/fix.md`) now read required changes from `bd show <id>` rather than from injected REPORT content.



- Ralph now stores incidental orchestrator artifacts under `.agent-cortex/ralph/` (logs, progress snapshots, and state) instead of the repository root.
- Ralph, run-beads, and stage prompt templates now consistently point progress logging to `.agent-cortex/ralph/ralph-<bead-id>.log`.
- Git ignore guidance now standardizes on ignoring `.agent-cortex/` so incidental runtime files stay out of source control.
- Skills that generate non-repo working artifacts now target `.agent-cortex/ralph/` (plans, idea records, and ubiquitous-language glossary) instead of `.working-docs/` or `docs/`.
- `technical-direction` now requires a `References` section when external evidence informs decisions, including web URLs and code line-level references.
