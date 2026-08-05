# Changelog

All notable changes to this repository are documented in this file.

## 1.35.1

### Changed

- **`.github/workflows/publish.yml`** — replaced `NPM_TOKEN` secret auth with
  npm Trusted Publishing (OIDC). The publish job now grants `id-token: write`
  and runs Node 24 / setup-node v6 (npm >= 11.5.1, required for OIDC). The
  publish step packs with `pnpm pack` and uploads the tarball with
  `npm publish` (pnpm 11's OIDC publish path is broken — pnpm#11513).
  Publishing no longer needs a long-lived npm token in repository secrets.
- **`.github/workflows/ci.test.ts`** — updated publish-workflow assertions to
  expect the OIDC shape: `id-token: write` permission, `pnpm pack` +
  `npm publish`, and no `NPM_TOKEN` / `NODE_AUTH_TOKEN` references.

### Fixed

- **`pnpm-workspace.yaml`** — `allowBuilds.esbuild` held a placeholder string
  (`set this to true or false`) that made `pnpm install` fail with
  `ERR_PNPM_IGNORED_BUILDS` under pnpm 11. Replaced with `false` (matching
  the other `allowBuilds` entries) so local installs and the `pnpm lint` /
  `pnpm test` / `pnpm build` pipeline run cleanly.

## 1.35.0

### Added

- **`.github/workflows/publish.yml`** — new npm publish workflow that
  triggers on GitHub release publication. Sets up Node with npm registry
  authentication, runs lint/test/build, then publishes via `pnpm publish`.
  Requires `NPM_TOKEN` secret in repository settings.
- **`.github/workflows/ci.test.ts`** — validation tests for CI and
  publish workflow structure, plus package.json publish configuration.
- **`package.json`** — removed `private: true` and added `build` and
  `lint` scripts, `publishConfig` with public access, and `tsx`/`yaml`
  devDependencies for workflow tests.

### Changed

- **`.github/workflows/ci.yml`** — renamed the `tests` job to `checks` and
  replaced the `Typecheck` step with `Lint` + `Build` steps.

## 1.34.0

### Added

- **`extensions/session-start.ts`** — now dynamically loads project context
  files (AGENTS.md, docs/user-preferences.md) and injects them into the
  session at startup. Agent gets baseline project context without manual
  file reads.
- **`extensions/context-loader.ts`** — new utility module for reading and
  formatting context files from the project root.
- **`extensions/skill-stats/context-loader.test.ts`** — tests for the
  context-loader module (9 tests).

## 1.33.0

### Added

- **`bin/agent-cortex.mjs`** — new CLI entrypoint for agent-cortex.
  Accepts `agent-cortex install <harness>` where harness is one of
  `copilot`, `claude`, or `pi`. Includes `--help` / `-h` support and
  proper error handling for unknown commands and harnesses.
- **`lib/cli.mjs`** — CLI logic module with argument parsing, help text,
  and harness validation.
- **`test/cli.test.mjs`** — 21 tests covering unit logic and CLI
  integration (Node built-in test runner).

## 1.32.2

### Fixed

- **`skills/workflow/run-pipeline-stage/`** — corrected stale path references
  (`skills/run-pipeline-stage/...` → `skills/workflow/run-pipeline-stage/...`)
  in the ralph agent and skill docs so the documented commands resolve from
  the repo root.
- **`extensions/skill-stats/`** — skill discovery and read-path resolution
  now handle the domain-grouped skills layout (`skills/<domain>/<name>/`)
  introduced by the reorganisation. `scanSkills` recurses into subdirectories
  and the path heuristic accepts nested skill paths, so reads of skills like
  `skills/workflow/run-pipeline-stage/SKILL.md` are correctly attributed in
  usage stats instead of being dropped as unknown.

## 1.32.1

### Fixed

- **`skills/style/style-tests/`** — fixed a YAML parse error in the skill's
  `description` front-matter (an unquoted colon followed by a space) that
  broke skill discovery on startup. Replaced the colon with an em dash.

## 1.32.0

### Added

- **`skills/workflow/using-agent-skills/`** — new meta-skill that routes
  incoming work to the right skill and enforces core agent behaviors
  (surface assumptions, manage confusion, push back, enforce simplicity,
  maintain scope discipline, verify don't assume). Adapted from upstream
  `addyosmani/agent-skills` with agent-cortex skill names and conventions.
  Includes a decision-tree workflow, lifecycle sequence, and structural
  validation tests.
- **`extensions/session-start.ts`** — now injects a reference to the
  `using-agent-skills` meta-skill at session start so agents can orient
  on available workflows without loading full skill content.

## 1.31.1

### Fixed

- **`skills/planning/create-task/SKILL.md`** — the documented `create-chores.ts`
  invocation used `pnpm --prefix skills/create-task/scripts exec tsx`, which runs
  with cwd set to the scripts dir. `bd` resolves its beads DB from cwd, so this
  made the script create chores against the skill repo's own `.beads` instead of
  the target project's — failing with `parent issue not found` for any project
  other than agent-cortex itself. Invocation now runs the `tsx` binary by
  absolute path (resolved from wherever the skill is actually installed, not
  hardcoded to one harness) so cwd stays in the target project. Also dropped
  the stale example path, which was missing the `planning/` segment from the
  domain-grouping reorg.

## 1.31.0

### Changed

- **`agents-native/ralph.md`**, **`claude/agents/ralph.md`**,
  **`skills/planning/classify-bead/SKILL.md`** — ralph now checks
  `bd label list <id>` itself before treating a ready bead as AFK/HITL,
  only falling back to the `classify-bead` subagent when the
  `implementation-type` label is missing. The `classify-bead` subagent and
  ralph's Fix worker now run on `model: haiku` (rubric lookup / scoped
  mechanical edits, not full reasoning), while Implementer and Reviewer
  keep the default model.

## 1.30.2

### Fixed

- **`skills/planning/create-task/scripts/create-chores.ts`** — pipeline stage
  chores (`code`/`verify`/`review`/`document`) were created with `--ephemeral`.
  `bd ready` excludes ephemeral issues by default, so ralph's documented plain
  `bd ready` calls never surfaced this work — it was invisible, not blocked.
  Stage chores are now plain (non-ephemeral) beads. Updated
  `skills/productivity/bd-tool/SKILL.md` and `.agent-cortex/ralph/ubiquitous-language.md`
  to match.

## 1.30.1

### Fixed

- **`claude/hooks.json`** — Claude Code rejects `prompt`-type hooks for
  `SessionStart` (no conversation context exists yet at startup). Switched
  both SessionStart hooks to `command`-type, echoing their text to stdout so
  Claude Code still injects it into session context.

## 1.29.0

### Fixed

- **`agents/ralph.agent.md`**, **`skills/workflow/ralph/SKILL.md`**,
  **`skills/workflow/ralph/REFERENCE.md`** — strengthened subagent
  spawning instructions to make it unambiguous that the `task` tool is
  the ONLY mechanism. Added explicit tool reference guide at the top of
  the ralph agent prompt with call format examples. All language now
  reads "call the `task` tool" instead of "spawn a subagent".
- **`extensions/subagent/index.ts`** — fixed `StringEnum` import that
  prevented the subagent extension from loading in PI v0.80.2, causing
  the `task` and `read_agent` tools to be unavailable.

## 1.28.0

### Added

- **`agents/plan.agent.md`** — new plan agent that guides features from
  first discussion through PRD and task breakdown to classified beads
  ready for ralph. Uses the `plan` skill as its workflow with explicit
  phase gates. Auto-discovered by the agent-modes extension as `/agent plan`.

## 1.27.0

### Added

- **`extensions/subagent/`** — new PI extension that registers a `subagent`
  custom tool for delegating tasks to isolated agent processes. Supports
  single, parallel (up to 8 tasks, 4 concurrent), and chained execution
  modes with streaming output and usage tracking.
- **`task` and `read_agent` tools** — added to the subagent extension for
  Copilot CLI compatibility. `task` spawns a background subagent and returns
  an ID immediately; `read_agent` retrieves the output when ready. This lets
  the ralph agent's background-spawn-and-poll workflow work identically in
  PI and Copilot CLI.

## 1.26.0

### Added

- **`extensions/agent-modes/`** — new PI extension that makes Copilot CLI
  agents (ralph, ralph-plan, strategy) available as switchable PI modes.
  Each mode restricts tools per the agent's frontmatter, injects the full
  agent prompt on every turn, and shows a status indicator.
  Commands: `/agent` (selector), `/agent <name>` (direct switch),
  `Ctrl+Shift+A` (cycle), `--agent <name>` (CLI flag).

## 1.25.0

### Added

- **`docs/user-preferences.md`** — new file recording personal development
  preferences (package manager, tooling choices) so both Copilot CLI agents
  and PI coding agents make decisions aligned with the user's habits.
  Initial entry: prefer PNPM over npm.

### Changed

- **`AGENTS.md`** — added a User Preferences section pointing agents to
  `docs/user-preferences.md` before making tooling or workflow decisions.
- **`extensions/session-start.ts`** — PI sessions now automatically inject
  a reference to `docs/user-preferences.md` so agents know to check it for
  personal tooling context.

## 1.24.3

### Changed

- **ralph: skip epic branch for single-feature epics** — when an epic has only one feature
  task child, ralph now branches `feature/<parent-id>` directly from `origin/main` and opens
  the PR straight into `main`, avoiding the awkward two-hop review. Epic branches are only
  created when there are two or more feature tasks.

## 1.24.2

### Added

- **`~/.copilot/copilot-instructions.md` setup** — a new `scripts/install-instructions.sh`
  script writes proactive skill-trigger rules into the global Copilot instructions file.
  Skills are now applied automatically (style, tdd, bd, review-security, etc.) without
  needing to invoke them by name. Re-run with `pnpm install` or
  `bash scripts/install-instructions.sh` to update. The managed block is marker-delimited
  so it coexists safely with any other content in the instructions file.

## 1.24.1

### Fixed

- **Fixed broken `pipeline.json` path in ralph skills** — all references to
  `skills/create-task/pipeline.json` have been updated to the correct path
  `skills/planning/create-task/pipeline.json`. Affected files:
  `skills/workflow/ralph/SKILL.md`, `skills/workflow/ralph/REFERENCE.md`,
  `skills/workflow/run-pipeline-stage/SKILL.md`, `agents/ralph.agent.md`,
  and `.agent-cortex/ralph/ubiquitous-language.md`.

## 1.24.0

### Added

- **New `plan` skill** — guides a feature from idea through PRD and task breakdown to
  classified beads ready for ralph execution, then produces a handoff bead ID. Covers
  the full workflow: codebase investigation, PRD creation, vertical-slice task
  breakdown, bead classification and pipeline expansion, and handoff preparation.
  Invoke with "plan this", "get this ready for ralph", or use it when starting a new
  feature that needs scoping before autonomous execution.

## 1.23.0

### Fixed

- **`extensions/notify/` now works on Windows/WSL** — switched from terminal OSC sequences
  (which Windows Terminal doesn't handle natively) to direct PowerShell toast notifications
  via `execFileSync`. Notifications use `ToastText04` template for proper multiline display:
  title (path · tmux), session name, and summary appear as separate lines.
- **Notification now persists on screen** — Windows toasts use `scenario="persistent"` so
  they stay visible until dismissed.
- **Error handling in notification summary** — if the LLM summary or config loading fails,
  the notification still fires with the raw response text as a fallback.

### Changed

- **`extensions/notify/` signature refactored** — `sendDesktopNotification` now accepts
  a `sections` array instead of a pre-joined body string, allowing each notification
  backend to format sections appropriately for its platform.
- **`pi/settings.json`** — `.pi/settings.json` is now tracked as the canonical global
  pi config symlinked from `~/.pi/agent/settings.json`.

## 1.22.0

### Added

- **`extensions/lib/tiny-model.ts`** — new shared module with config loading
  and LLM helpers for making cheap side-agent calls. Reads a `tinyModel`
  config key from settings.json (global + project merged). Provides
  `generateNameFromPrompt()` and `summarizeResponseText()` backed by the
  `complete()` function from `@earendil-works/pi-ai`.
- **`pi/settings.json`** — added `tinyModel` config key defaulting to
  `opencode/mimo-v2.5-free`, our tiniest free configured model.

### Changed

- **`extensions/auto-name.ts`** — rewritten to use the configured tiny model
  for LLM-generated session titles instead of simple truncation. On the first
  user prompt, calls the side agent asynchronously and falls back to
  truncation if the model is unavailable or the call fails. Existing names
  (set via `--name` or `/name`) are never overwritten.
- **`extensions/notify/`** — notification format is now multiline:
  `path \n session-name \n summary`. The summary is generated by the
  configured tiny model (extracting text from the last assistant response),
  falling back to word-broken truncation. The path line always shows a
  truncated full path (e.g. `~/src/agent-cortex`). The tmux
  session:window.pane identifier remains as the notification title.

## 1.21.0

### Added

- **`pi/settings.json` is now tracked and is the canonical global pi config** —
  it's symlinked from `~/.pi/agent/settings.json`. All `pi install` / `pi remove`
  and provider/model settings are version-controlled and reproducible on a fresh
  checkout.
- **`extensions/notify/` now handles desktop notifications** — replaced the
  `pi-notify` npm dependency with a local extension that sends OSC desktop
  notifications on multi-turn tasks. Notifications are labelled with the tmux
  session:window.pane identifier when available, or the project directory name
  otherwise.
- **`pi/settings.json` pins versions** for `pi-web-access` (package deps are
  deliberate commits, not drift).
- **README** — documented the global config symlink setup, redeploy
  instructions, and package dependencies.
- **`.gitignore`** — removed `pi/settings.json` ignore rule so the global
  config is tracked. Added `.pi/npm/` and `.pi/node_modules/` for project-level
  install artifacts.

### Removed

- **`pi-notify` dependency** — replaced by local `extensions/notify/` which
  provides the same OSC desktop notification functionality with customisable
  labels (tmux context or project name).

## 1.20.0

### Added

- **`extensions/notify/`** — new pi extension that emits a terminal bell when pi
  finishes a multi-turn task (≥2 turns or ≥30s runtime). Tmux catches this via
  `monitor-bell` + `visual-bell` and shows "Bell in window X", so you can
  navigate directly to pi's session/window with `y`/`g`.

### Changed

- **Zsh theme** — replaced naive bell-on-every-precmd with a threshold approach:
  only ring bell if last command ran ≥10 seconds. Prevents noise from `cd`, `ls`,
  and pi's internal bash tool calls.
- **Tmux config** — enabled `allow-passthrough on` so OSC 777/99/9 escape sequences
  pass through to the terminal emulator (needed by `pi-notify` and
  `copilot-plugin-notify`). Simplified `g`/`G` bindings to plain session cycling.

## 1.19.0

### Added

- **`git-workflow` skill** — defines the default git discipline: feature branches,
  git worktrees for isolation, and PRs for all changes. Auto-loaded every session
  via a new `before_agent_start` extension.
- **`extensions/session-start.ts`** — general session-start extension that injects
  `git-workflow` and `bd-tool` skills into `systemPromptOptions.skills` so the
  agent always has workflow context available. The place to add future
  session-start concerns.

## 1.18.1

### Fixed

- **Removed stale nexus references from skills and docs** — the
  `improve-codebase-architecture` skill was broken: it spawned `agent-cortex:nexus`
  sub-agents that don't exist. Rewrote to use direct tool-based exploration and
  inline interface design instead. Also cleaned up stale `nexus.agent.md` refs in
  `README.md`, `docs/inspirations.md`, and research docs.

## 1.18.0

### Changed

- **Grouped skills into domain subdirectories** — the flat listing was unwieldy. Skills
  now live under `planning/`, `engineering/`, `productivity/`, `style/`, `workflow/`,
  and `review/`. Discovery is recursive, so no config changes needed.
- Updated `AGENTS.md` structure diagram.

### Removed

- **Removed `obsidian-vault` skill** — never used.

## 1.17.0

### Added

- **New skill: `grill-me`** — lightweight grilling session for stress-testing plans and
  designs (no CONTEXT.md/ADR scaffolding). Imported from mattpocock/skills.
- **New skill: `handoff`** — compacts the current conversation into a handoff document
  for another agent to pick up. Imports from mattpocock/skills.
- **New skill: `teach`** — multi-session teaching workspace with lessons, reference docs,
  learning records, and glossary support. Imports from mattpocock/skills.
- **New PI extension: `skill-stats`** — tracks skill usage across PI sessions. Records when
  skills are loaded, invoked via `/skill:name`, or actively read by the LLM. Data stored in
  `~/.pi/agent-cortex/skill-usage.json` with per-project breakdowns. Provides `/skill-stats`
  dashboard and `/skill-usage-reset`. Useful for identifying unused context-budget burners.
- **Added `package.json` with `pi` manifest** — the repo is now installable as a PI
  package. Extensions and skills are auto-discovered by PI.

### Removed

- **Removed `ubiquitous-language` skill** — superseded by `grill-with-docs` which builds
  and maintains `CONTEXT.md` inline with more structure (term glossary, ADRs, scenario
  probing). All cross-references updated to point to `grill-with-docs` instead.

### Changed

- Updated cross-references in `style-code`, `tdd`, `ralph-plan.agent.md`, and
  `docs/research/skill-design-research.md` to use `grill-with-docs` instead of
  `ubiquitous-language`.
- Updated `AGENTS.md` structure diagram to reflect new and removed skills.

## 1.16.0

### Added

- New `skills/prd-to-tasks/SKILL.md` — merges `prd-to-plan`, `plan-to-epics`, and `epic-to-tasks`
  into a single skill that takes a PRD and produces the full bead tree (epics + tasks) in one
  pass. Epics are the source of truth; no intermediate plan file.
- Recorded terminology decisions in `.agent-cortex/ralph/ubiquitous-language.md`: epic/task/stage
  hierarchy, pipeline definition, and canonical term glossary.

### Removed

- Removed `skills/prd-to-plan/` — superseded by `prd-to-tasks`.
- Removed `skills/plan-to-epics/` — superseded by `prd-to-tasks`.
- Removed `skills/epic-to-tasks/` — superseded by `prd-to-tasks`.

### Changed

- **Renamed `skills/beads/` → `skills/bd-tool/`**: clarifies this is about `bd` CLI mechanics
  (prime, show, claim, close), not bead concepts. Removed classification section
  (AFK/HITL/NEEDS-REFINEMENT) — delegated to `classify-bead` skill.
- **Renamed `skills/run-beads/` → `skills/run-pipeline-stage/`**: clarifies this is a generic
  pipeline stage executor, not TDD-specific. Removed classification section. Pipeline stages
  aligned with canonical `pipeline.json` (`code → verify → review → document`). Internal paths
  updated throughout (playbooks, prompts, scripts).
- **Reconciled pipeline definitions**: `run-pipeline-stage` SKILL.md now references
  `skills/create-task/pipeline.json` as the canonical pipeline source. Stage IDs
  (`stage:code`, `stage:verify`, `stage:review`, `stage:document`) now match what
  `create-chores.ts` creates. Fix loop caps read from `pipeline.json`'s `maxFixRounds`.
- `ralph.agent.md`: updated all `run-beads` references to `run-pipeline-stage`; replaced
  classification reference with `classify-bead` skill; updated dispatch rules to 4-stage
  pipeline; TDD loop cap removed, fix caps aligned to `pipeline.json`.
- `skills/ralph/REFERENCE.md`, `skills/ralph/SKILL.md`: updated path references to
  `run-pipeline-stage`.
- `skills/create-task/templates/*.md`: updated progress logging cross-references from
  `run-beads` to `run-pipeline-stage`.
- `AGENTS.md`: updated directory tree and agent delegation description.
- `.github/workflows/ci.yml`: replaced per-skill install/test/typecheck steps with a single
  workspace setup (`pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`).
  Created root `package.json` and `pnpm-workspace.yaml` to unify all `skills/*/scripts`
  directories as a pnpm workspace.
- `agents/ralph-plan.agent.md` step 1: replaced `prd-to-plan` reference with `prd-to-tasks`;
  when input is a PRD, skip to step 7 (agree with user) since the skill handles exploration
  and breakdown internally.
- `agents/ralph-plan.agent.md` step 6: replaced `epic-to-tasks` with `prd-to-tasks` for large
  workstreams.
- Updated `docs/research/skill-design-research.md` — removed stale references to removed
  skills from line-count stats, split candidates, and multi-phase skill list.

## 1.15.0

### Changed

### Changed

- Rewrote `skills/beads/SKILL.md` to the anatomy template: added `When to use`, `When NOT to use`, `Philosophy / rationale`, `Workflow`, `Red Flags`, `Common Rationalizations`, `Cross-skill references`, `Examples`, and `Verification checklist`; removed MCP server references; restructured existing key-commands reference and epics guidance into canonical workflow with phase separation.

### Removed

- Removed `beads` MCP server from `plugin.json` — CLI-based usage is the primary interface.

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
