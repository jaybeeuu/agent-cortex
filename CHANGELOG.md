# Changelog

All notable changes to this repository are documented in this file.

## 1.14.0

### Removed

- Removed `skills/triage-issue/` — the dedicated bug triage skill. After review, the
  investigation steps are what a competent agent does by default; the few real conventions
  (severity tagging) are now inlined into `ralph-plan.agent.md`.

### Changed

- `agents/ralph-plan.agent.md` step 3: replaced `triage-issue` invocation with inline
  investigation instructions.
- `agents/ralph-plan.agent.md` step 6: added severity tagging (`bd tag <id> severity:<p0|p1|p2|p3>`)
  for bug/regression beads, with a severity-to-priority map.
- Updated `docs/research/skill-design-research.md` — removed `triage-issue` from the list of
  argument-hint candidates.

## 1.13.0

### Removed

- Removed `skills/qa/` — the conversational QA session skill. Was unused; bug filing is better
  done directly via `create-task`.

### Changed

- Rewrote `skills/triage-issue/SKILL.md` to the anatomy template with deepened investigation
  (subsequently removed in 1.14.0).
- Updated `docs/research/skill-design-research.md` — removed `qa` from line-count stats and
  split-candidate list.

## 1.12.0

### Changed

- Rewrote `skills/review-security/SKILL.md` to the anatomy template: added `When to use`, `When NOT to use`, `Philosophy / rationale`, `Workflow`, `Red Flags`, `Common Rationalizations`, `Cross-skill references`, `Examples`, and `Verification checklist`; restructured existing gitleaks commands into canonical workflow with scope-selection table.

## 1.11.0

### Changed

- Rewrote `skills/tdd/SKILL.md` to the anatomy template: added `When to use`, `When NOT to use`, `Philosophy / rationale`, `Red Flags`, `Common Rationalizations`, `Cross-skill references`, `Examples`, `Phase-gate checklists`, and `Verification checklist`; reorganised existing workflow into canonical structure.

## 1.10.0

### Changed

- Rewrote `skills/style-tests/SKILL.md` to the anatomy template: added `When to use`, `When NOT to use`, `Philosophy / rationale`, `Workflow`, `Red Flags`, `Common Rationalizations`, `Cross-skill references`, `Examples`, and `Verification checklist`; restructured existing principles into ordered workflow steps.

## 1.9.0

### Changed

- Rewrote `skills/style-documentation/SKILL.md` to the anatomy template: added `When to use`, `When NOT to use`, `Philosophy / rationale`, `Workflow`, `Red Flags`, `Common Rationalizations`, `Cross-skill references`, `Examples`, and `Verification checklist`; tightened the documentation philosophy into clear decision rules.

### Fixed

- Revised `skills/style-code/SKILL.md` abstraction guidance: Red Flag now says "across multiple callers" and Common Rationalizations clarifies "at least a third real caller" as the threshold for promoting a local helper to a shared module.

## 1.8.0

### Changed

- Rewrote `skills/style-code/SKILL.md` to the anatomy template: added `When to use`, `When NOT to use`, `Philosophy / rationale`, `Workflow`, `Red Flags`, `Common Rationalizations`, `Cross-skill references`, `Examples`, and `Verification checklist`; restructured existing reference sections into ordered workflow steps; added `REFERENCE.md` for extended examples.

## 1.7.0

### Changed

- Rewrote `skills/style-comms/SKILL.md` to the anatomy template: added `When to use`, `When NOT to use`, `Philosophy / rationale`, `Workflow`, `Cross-skill references`, `Examples`, and `Verification checklist` sections; restructured existing reference content into ordered workflow steps; added good/bad example pairs; updated description to the canonical two-sentence format with quoted trigger phrases.

## 1.6.0

### Changed

- Rewrote `skills/write-a-skill/SKILL.md` to the anatomy template: added `When to use`, `When NOT to use`, `Red Flags`, `Cross-skill references`, and `Examples` sections; renamed `Process` → `Workflow` and `Review checklist` → `Verification checklist`; converted body to imperative second-person voice; added quoted trigger phrases to description.

## 1.5.1

### Removed

- Removed `write-a-skill guidance deltas` test block from `skills/run-beads/scripts/generate-progress.test.ts` — it tested markdown file content, not code.

## 1.5.0

### Added

- New `refactor-skill` interactive skill that upgrades existing SKILL.md files to the canonical anatomy template through gap analysis, user interview on optional sections, and one-pass rewrite.

## 1.4.1

### Removed

- Removed `skills/run-beads/scripts/ralph-plan-planning-gate.test.ts` — the test was invalid/bunkum and did not belong in the PR.

## 1.4.0

### Added

- Added a GitHub MCP server entry to `plugin.json` so the plugin can talk to GitHub through a stdio MCP process launched with `pnpm dlx`.
- Documented the integration through the version bump so downstream installs pick up the new server registration.

## 1.3.0

### Changed

- Tightened `agent-cortex:ralph-plan` Step 6 so every feature/task planning gate must stay open until the user explicitly confirms that specific item, and gate descriptions must be cold-start-ready (scope, decisions, open questions/risks, references).
- Tightened `agent-cortex:ralph-plan` Step 7 so plan handoff output includes per-gate status (`✅`/`⏳`) and an explicit warning whenever any planning gates remain open and still block ralph handoff.

### Added

- Added `skills/run-beads/scripts/ralph-plan-planning-gate.test.ts` assertions that lock in the Step 6/7 confirmation, cold-start context, and open-gate warning requirements.
## 1.2.1

### Changed

- Removed tracked `.agent-cortex/working-docs/.gitkeep` so planning scratch space stays out of source control.
- Updated `run-beads` promotion regression tests to verify promoted docs are absent from any local `.agent-cortex/working-docs` paths without requiring that directory to exist in a checkout.

## 1.2.0

### Added

- Promoted `skill-design-research.md` and `skill-improvements-analysis.md` into `docs/research/` and added Inspirations backlinks from every research doc.

### Changed

- Reworked `docs/skills/skill-anatomy.md` to document optional-section facets, enforce `When NOT to use` adjacency, and end with a full annotated template.
- Updated `skills/write-a-skill/SKILL.md` with new line-limit guidance, voice/tone rules, front-matter field coverage, and checklist alignment to anatomy requirements.
- Updated `docs/inspirations.md` to link all promoted research docs.

## 1.1.0

### Added

- Added `docs/skills/skill-anatomy.md` as the canonical anatomy specification, including an annotated template and acceptance checklist.
- Added `docs/research/skill-patterns-research.md` to centralize research-backed rationale for skill structure patterns.

### Changed

- Updated `skills/write-a-skill/SKILL.md` to align with canonical anatomy guidance, explicit description rules, and line-limit/voice expectations.
- Updated `docs/inspirations.md` to include required links to internal research docs under `docs/research/`.

## 1.0.0

### Changed

- Removed the `prd-to-epics` skill to eliminate overlap with the `prd-to-plan` → `plan-to-epics` flow and keep one canonical decomposition path.

## 0.40.1

### Changed

- `run-beads` tests no longer assert markdown output string matches in `generate-progress.test.ts`.

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
