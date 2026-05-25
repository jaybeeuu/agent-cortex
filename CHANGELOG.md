# Changelog

All notable changes to this repository are documented in this file.

## 0.41.0

### Added

- Plugin session-start hook wiring: plugin manifest now declares `hooks.json`, and a new `hooks.json` adds a `sessionStart` prompt hook that instructs agents to run `bd prime` at session start.

## 0.40.0

### Fixed

- `generate-progress.ts` script path: all `pnpm --prefix … exec tsx generate-progress.ts` references now use the absolute installed-plugin path (`~/.copilot/installed-plugins/_direct/agent-cortex/…`) plus `--workspace "$(pwd)"`. This fixes script execution when ralph runs in a user's project workspace where the relative `skills/run-beads/scripts` path does not exist.
- `generate-progress.ts` workspace path: replaced `--workspace "$(pwd)"` with an explicit variable pattern (`workspace="/absolute/path"`) in all instruction files (`ralph.agent.md`, `skills/ralph/SKILL.md`, `skills/run-beads/SKILL.md`, `skills/ralph/REFERENCE.md`). Also fixed the `> .agent-cortex/ralph/progress.md` output redirect to use the same variable (`> "$workspace/.agent-cortex/ralph/progress.md"`). Prevents agents from simplifying `$(pwd)` to `.`, which caused the wrong `.beads` database to be found when running under `pnpm --prefix`.

### Changed
- `record-idea` skill: idea files are now written to `docs/ideas/` instead of `.agent-cortex/ralph/ideas/` so they are tracked by git.

### Fixed

- `ralph` agent and skill: enforce foreground-only execution — ralph now warns and requests re-run if accidentally invoked as a background task.
- `ralph` agent: HITL Pause now kills any running poll-timer shell before stopping, so the timer can no longer fire and wake ralph up after it has paused. The action required per bead now explicitly instructs `bd close <id>` so it is clear what the human must do to unblock ralph.

### Added

- Agent rule: maintain `CHANGELOG.md` and update it in the same commit as any repository change.
- New `technical-direction` skill for collaborative technical design: challenges assumptions, derives constraints from codebase context, evaluates alternatives (including autonomous web research when needed), and writes decision memos to `docs/technical-direction/`.
- New `agent-cortex:strategy` agent that creates top-level design documents across vision brief (`docs/strategy/`), PRD (`docs/prd/`), and technical direction, with evidence-backed tradeoffs before `ralph-plan`.
- New `hitl-collab` skill to produce HITL handoff docs under `.agent-cortex/working-docs/` and optionally update bead notes when details are missing.

### Added

- New `style-tests` skill

### Changed

- `ralph` agent and skill: when fully blocked on HITL gate beads (feature PR gates or epic PR gates) with no AFK work remaining, ralph now outputs a **Pending Human Action** summary table (bead ID, title, action needed, PR link) and stops — instead of idling the poll timer in a loop.
- `record-idea` skill: replaced validity-check interview questions with why/how/when/priority framing; updated template to match.
- Skills updated to use `.agent-cortex/ralph/`
- Ralph now opens and reports feature PRs immediately at the HITL gate (agent-branch → feature branch) instead of waiting to push.
- Ralph now creates feature worktrees under `.agent-cortex/worktrees/` instead of `.worktrees/`.
- Ralph planning scratchpad notes now live under `.agent-cortex/working-docs/` (no more `.working-docs/`).
- Ralph now bases epic branches (and thus worktrees) on the latest `origin/main` rather than local `main`.
- CI now runs run-beads tests/typechecks and create-task typechecks on pull requests and main.

### Fixed

- CI workflow no longer assumes `pnpm` is preinstalled when setting up Node.

- `ralph` agent (agents/ralph.agent.md) now uses a chore-bead-per-stage model consistent with `skills/ralph/`. Each pipeline stage creates its own chore bead on-demand; `stage:*` tags live on chore beads, not on the parent feature bead. `state.json` inflight entries now track `choreId`+`parentId` instead of a single `beadId`. Loop counts (TDD loops, fix rounds) are derived from `bd children` queries rather than counters in state.

 Both the `run-beads` pipeline (ralph agent) and the `ralph` skill pipeline now create feedback beads on failure; the orchestrator sees them as ordinary ready beads and only needs to enforce loop caps before dispatching. The `fix` prompt templates (`run-beads/prompts/fixing.md` and `create-task/templates/fix.md`) now read required changes from `bd show <id>` rather than from injected REPORT content.



- Ralph now stores incidental orchestrator artifacts under `.agent-cortex/ralph/` (logs, progress snapshots, and state) instead of the repository root.
- Ralph, run-beads, and stage prompt templates now consistently point progress logging to `.agent-cortex/ralph/ralph-<bead-id>.log`.
- Git ignore guidance now standardizes on ignoring `.agent-cortex/` so incidental runtime files stay out of source control.
- Skills that generate non-repo working artifacts now target `.agent-cortex/ralph/` (plans, idea records, and ubiquitous-language glossary) instead of `.working-docs/` or `docs/`.
- `technical-direction` now requires a `References` section when external evidence informs decisions, including web URLs and code line-level references.
