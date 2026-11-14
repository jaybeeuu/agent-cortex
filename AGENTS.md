# AGENTS.md

Instructions for agents working on this repository.

## What This Repo Is

A personal collection of custom agents and skills, shipped to pi and Claude Code, plus PI
extensions and Claude hooks for enhancing the coding agent runtime.

This repository builds a **tool for installation on other machines**, not a service that runs here.
`agent-cortex` is published to npm, installed into `~/.agent-cortex/`, and then used by other
projects on other machines. Changes reach every install, so the installed package — not this
checkout — is the thing being designed.

## Decisions are generic, not local

Every command, skill, agent, extension, hook, and test ships to machines that do not have this
checkout, this branch layout, or this CI provider. Design against the installed artefact and the
consumer's environment, never against what happens to work here.

- A rule belongs in shipped code (`skills/`, `agents/`, `extensions/`, `hooks/`, `bin/`, `lib/`)
  only when it is true on an arbitrary machine. Facts about *this* checkout — branch bases, merge
  method, signature rules, required checks, release mechanics — belong in `AGENTS.md`, `docs/`, or
  the tracker.
- Never hardcode a path, hostname, harness version, or CI provider into shipped code. Read it from
  the environment, or make it configuration with a documented default.
- A check that only passes because this checkout is present is not a check. Stage an install and
  exercise the artefact outside the repo (`--output <dir>`, `test/pi-extensions-load.test.mjs`).
- When a behaviour cannot be made generic, fork it explicitly at install time through the
  `{{TOOL:...}}` / `{{PATH:...}}` token grammar, and record why the fork exists.
- Evidence from this repository is a sample, not the specification. A one-off instruction for this
  checkout — "merge these PRs now", "rebase that branch" — never becomes shipped policy unless the
  owner says the policy itself should change.

## Structure

```
agent-cortex/
├── package.json           # PI package manifest (pi: { extensions, skills }) + pi runtime deps
├── agents/                # Custom agents — canonical composable <name>/ dirs
│   ├── ralph/             #   composable format (shared agent.md + pi/, claude/) — see agents/README.md
│   ├── plan/              #   "
│   ├── ralph-plan/        #   "
│   └── strategy/          #   "
├── skills/               # Grouped by domain, discovered recursively
│   ├── planning/         # Scope, spec, decompose
│   ├── engineering/      # The coding loop
│   ├── productivity/     # Workflow tooling
│   ├── style/            # Conventions and standards
│   ├── workflow/         # Orchestration and pipeline
│   └── review/           # Auditing and maintenance
├── extensions/           # PI extensions (one directory per extension, each with index.ts)
│   └── skill-stats/
│       ├── README.md      # Installation & usage
│       └── index.ts       # Extension entrypoint
├── hooks/                # Canonical Claude Code hooks (hooks.json + scripts — see docs/claude-hooks.md)
│   └── claude/           #   generated into the plugin's hooks.json + hooks/ by bin/installers/claude.mjs
├── claude/               # Committed Claude user-settings template — merged into ~/.claude/settings.json on install
├── claude-extras/        # Hand-authored Claude plugin extras
│   ├── .mcp.json         # MCP servers (context7, github) — copied into installs
│   └── scripts/          # statusline-command.sh — copied into installs (executable)
└── package.json          # PI package manifest (pi: { extensions, skills }) + pi runtime deps
```

## Versioning

Use `pnpm changeset` for all version bumps. Never edit versions manually.
`package.json` and `CHANGELOG.md` stay in lockstep automatically.
See the `style-versioning` skill for the full workflow.

## Changelog

Generated automatically by changesets. Do not edit `CHANGELOG.md` manually.

## Coding Conventions

- **Landing method**: pull requests are squash-merged. Merge commits are disabled in the
  repository settings and `main` requires linear history, so a branch's own commit shape never
  reaches `main`. `docs/commit-signing.md` records why squash is the only landing path that
  produces a signed commit.
- **Mid-branch sync**: bringing a behind branch up to date is a *separate* decision from landing —
  rebase it onto its base branch locally (`main`, or `epic/<id>` for a feature branch inside an
  epic), never merge the base in. `commit.gpgsign=true` re-signs the rewritten commits
  automatically, so no extra flag is needed; force-push with `--force-with-lease`, never
  `--force`. Rebase only your own unmerged branch — never `main` or an `epic/<id>` branch others
  are based on, and never a branch another person or agent is working on. An integration branch
  is the one thing you sync by merging the base in. The rule and its reasoning live in the
  `git-workflow` skill (rule 6).
- **Never block the main thread**: no `*Sync` functions (`readFileSync`, `spawnSync`, …).
  Tooling code in `bin/`, `scripts/`, `lib/`, `hooks/`, and `test/` must be async —
  enforced by `scripts/check-no-sync.mjs` (runs via `pnpm lint`). Skill-owned
  scripts (`skills/*/scripts`) and `extensions/` are the remaining sync surfaces.
- **Temp workspaces in tests**: a test file that needs workspaces under the system temp dir
  gets them from `createTempRoot()` in `test/helpers/temp-root.mjs`. That helper removes the
  whole root from a file-level `after()` hook, so a test that throws before its own cleanup
  cannot leak its workspace. Do not call `mkdtemp(tmpdir())` directly.
- **Share generic tooling helpers in `scripts/lib/`**: tooling code (installers under
  `bin/installers/`, hooks, other scripts) imports shared utilities from `scripts/lib/`
  (e.g. `compose-agent.mjs`, `fs.mjs`) rather than redefining them inline.
- **`scripts/` is a runtime asset, not just build tooling**: `bin/agent-cortex.mjs` imports
  `scripts/lib/migrate.mjs` for `migrate`, and the installers import
  `scripts/lib/{compose-agent,fs}.mjs` — so any `package.json` `files` whitelist must include
  `scripts/`, or published installs and `migrate` break for consumers while every local run
  stays green.

## Skill Conventions

- **Skills are portable, not repo documentation.** See _Decisions are generic, not local_ above.
  `skills/` is installed onto arbitrary machines (pi, Claude Code), so it describes general practice
  and the author's portable preferences — never how this repository is configured or how to work in
  it. Repo-local `.agents/skills/` follows the same rule: a skill is a skill, not a place for this
  repo's configuration.
- `SKILL.md` must include a YAML front-matter block with `name` and `description`. `pnpm lint`
  enforces this (`pnpm check:skills`), because PI silently drops a skill whose frontmatter it
  cannot parse.
- `description` must be ≤ 1024 characters. First sentence: what it does. Second: "Use when…".
- Keep `SKILL.md` near the ~150-line target in `docs/skills/skill-anatomy.md`, overflowing into
  purpose-named support files (`REFERENCE.md`, `EXAMPLES.md`, `FORMAT.md`). `style-tests`
  deliberately sits at the top of that range rather than splitting — its principles must load
  automatically with the skill.
- Add utility scripts to `scripts/` when an operation is deterministic and would otherwise be
  regenerated each time (e.g. install scripts, scanners). A `skills/<group>/<name>/` directory
  with no `SKILL.md` is not tooling: both installers skip it silently, and `pnpm check:skills`
  does not flag it either, because that check scans `SKILL.md` files only. `scripts/validate-agent-dir.mjs`
  is the worked example — it validates this repository's own composable `agents/` tree, and no
  install contains that tree, so it was never a portable skill.
- Skill names use kebab-case and are grouped by prefix where related (e.g. `review-security`,
  `review-code`; `style-code`, `style-comms`, `style-documentation`).
- A skill that reads a document names it with a `{{PATH:...}}` token, never a repo-relative path:
  the token map's `docs/` entries are exactly the documents an install ships, and
  `test/installed-docs.test.mjs` fails when a rendered skill names a repository doc the install does
  not contain.

## Agent Conventions

- Agents live in composable `<name>/` directories under `agents/`: a shared `agent.md` body plus
  per-harness subdirectories `pi/` and `claude/` (frontmatter.json and optional section files) per
  the spec in `agents/README.md`. `ralph`, `plan`, `ralph-plan`, and `strategy` all use the
  composable layout, and no flat agent file is committed — each harness renders its own at install
  time. The Claude plugin is materialised by the install-time generator
  `bin/installers/claude.mjs`: a plain `agent-cortex install claude` copies it into
  `~/.agent-cortex/claude` (skills copied flat with `{{TOOL:...}}`/`{{PATH:...}}` substituted,
  never symlinked, plus the bundled docs that skills read — one copy per install, verbatim), writes the
  marketplace manifest at
  `~/.agent-cortex/.claude-plugin/marketplace.json`, merges the committed `claude/settings.json`
  template into `~/.claude/settings.json`, and registers it with Claude Code via the
  `claude plugin` CLI. The settings merge preserves personal config: the CLI owns exactly the
  `enabledPlugins` + `extraKnownMarketplaces` entries the template declares, entries it does not
  declare survive (including the one Claude Code writes when the user enables the plugin), and
  every other key is left untouched. Only
  that settings template is committed under `claude/` — the generated plugin subtree is not;
  hand-authored plugin extras live in `claude-extras/` (`.mcp.json`, `scripts/`), and
  `--output <dir>` is the generate-only form (tests/CI materialiser checks); every agent,
  `ralph` included, composes from its `claude/` harness dir).
- The pi package is materialised by `bin/installers/pi.mjs`: `agent-cortex install pi` stages a
  self-contained pi package in `~/.agent-cortex/pi` (manifest, flat rendered agents, token-substituted
  skills, the bundled docs that skills read, a copy of `extensions/`, `token-map.json`, and the bundled
  `pi.packages` closure under
  `node_modules/`) and registers that directory with pi through the `pi` CLI — pi's own
  `~/.pi/agent/settings.json` is read, never written. `--output <dir>` stages only (no registration,
  no sweep) and `--dry-run` reports the plan. Once registration succeeds, a one-shot migration sweeps
  the copies the pre-staged-model installer rendered into `~/.pi/agent`, attributing them by name from
  the package root and recording completion in `~/.agent-cortex/legacy-sweep.json`; `~/.pi/agent/extensions`
  is never touched. Run it from the main checkout: the staged package is a snapshot of the checkout you
  invoked, so a run from a ralph worktree stages that worktree's content. The staged extensions
  value-import nothing from pi's runtime, except `typebox`, which pi's loader aliases for
  extensions. `test/pi-extensions-load.test.mjs` loads every staged extension from a temp
  directory outside the checkout, so a re-introduced runtime import fails the suite.
- Keep orchestration logic in the agent file; extract shared per-task workflow into a skill
  so it can be reused (e.g. ralph delegates per-task stage execution to `run-pipeline-stage`).
- The planner ↔ ralph peer channel ships as skill text alone, forked at install time through
  token-map.json: `{{TOOL:peer_send}}` and `{{TOOL:peer_list}}` render as the `pi-peer` package's
  tools on pi and as Claude Code's built-in `SendMessage` and `ListAgents` on claude. A consuming
  repository installs `@cryptolibertus/pi-peer` itself; it is never a `package.json` dependency of
  this package and never part of the bundled `pi.packages` closure. The convention lives once in
  `skills/workflow/ralph/REFERENCE.md` and is cross-referenced from `plan`: only its `### Transport`
  subsection differs per harness, while the message kinds and the acknowledgement rule stay
  byte-identical, and `test/skill-transport-render.test.mjs` stages both installs to prove it.
  A new message kind, or a change to the acknowledgement rule, therefore goes in the shared text
  and never into a per-harness `### Transport` — a kind that exists on one harness only would
  break the byte-identical render.
  `pi-peer`'s `peer_get` and `peer_await` have no Claude Code counterpart, so they are named only
  inside the harness-labelled `pi-peer` runbook — a null claude mapping would drop the token and
  leave the sentence broken.
- The post-merge watch forks the same way, through the single row `{{TOOL:post_merge_watch}}`:
  `post-merge-watch` (this package's own extension, on pi) and Claude Code's built-in
  `ScheduleWakeup` (on claude). The values differ in kind — an extension on one side, a tool on the
  other — so the surrounding prose describes only what both do (the session resumes, the check runs
  again, the verdict table is unchanged) and never a call shape. `skills/workflow/run-pipeline-stage/playbooks/post-merge.md`
  is its one authored home; the stage instructions, the three verdicts and the escalation rule stay
  outside that section and byte-identical across renders. Because a watcher is a property of the
  session, the no-watcher fallback is plain prose in the same section, so it survives both renders
  and neither side is assumed to have the mechanism. `test/post-merge-transport-render.test.mjs`
  stages both installs to prove it.
  The claude value is `ScheduleWakeup` and not `Monitor` because `ScheduleWakeup` is a self-paced
  re-prompt while `Monitor` is an event watcher behind a feature flag that defaults off
  (`isEnabled(){return T("tengu_amber_sentinel",!1)}` in 2.1.294). A skill installed on an
  arbitrary machine cannot rely on a gated capability, so the row names the mechanism every
  session has. Re-check that flag before changing the row; do not promote `Monitor` on the
  strength of its presence in the binary.

## PI Extension Conventions

- PI extensions live in `extensions/`, one subdirectory per extension.
- Each extension directory contains `index.ts` (entrypoint) and `README.md` (usage).
- Extensions are auto-discovered when the repo is installed as a PI package via `pi install`.
- Keep extensions lightweight: no internal LLM calls. Extensions observe events and provide
  commands — they should not add token overhead.
- Register CLI flags from the extension factory (load time), never from a `session_start`
  handler: PI matches parsed CLI flags against the extensions loaded at startup, so late
  registration makes the flag fail with `Unknown option`.
- Extensions that persist data should write to `~/.pi/agent-cortex/` (global, cross-project)
  and tag records with the project path for per-project slicing.
- Extensions reference pi as `import type` only, so each workspace carries `@earendil-works/pi-*`
  as a `devDependency` for `tsc` and nothing at runtime. Pin it to the pi version the CLI actually
  runs (`pi --version`), so `pnpm typecheck` checks the installed API. The guard is
  `extensions/agent-modes/index.test.ts`: its `ExtensionAPI` double is a complete literal, so a pi
  release that grows the interface fails `tsc` there. Add the member to the double — a cast such as
  `as unknown as ExtensionAPI` silently drops the check.
- PI extensions with Claude Code equivalents are ported to `hooks/claude/`; the port/reject
  audit with rationale lives in `docs/claude-hooks.md`.

## User preferences

Before making tooling or workflow decisions, read `docs/user-preferences.md` for the
user's personal development preferences (e.g. preferred package manager, tooling
choices). These preferences apply across all projects where this plugin is active.

## Task tracking

This project uses **bd (beads)** for task tracking.

Run `bd prime` at the start of each session for context.

**Two axes.** A bead's *type* is its workflow stage — `idea` (a `kind:idea` bead) → `epic` →
`feature` → `chore`/`task` — and its `execution` label answers who does the work:
`execution:afk` (agent-routable) or `execution:hitl` (human-required). The label is a query filter
only: it never auto-claims and nothing enforces it, so claim mechanics are unchanged. Each bead
carries the class of its own work — nothing aggregates upward.

**Hierarchy.** `--parent` is ownership; `bd dep add` is execution ordering; dependencies are the
whole readiness gate (there is no separate "ready" label).

```
feature (execution:hitl)
├── "Plan: <feature>"  execution:hitl  --parent feature
└── <deliverable>      execution:afk   --parent feature + bd dep add <deliverable> <plan-bead>
```

Pass `--no-inherit-labels` beside `--parent`: `bd` copies a parent's labels at create time, so a
child of an `execution:hitl` feature would otherwise acquire `execution:hitl` next to the
`execution:afk` label its own work needs. The planning bead is the design gate, so implementation
children stay out of `bd ready` until it closes. `create-task` builds this shape, `classify-bead`
resolves the label, and `ralph` executes `bd ready -l execution:afk`.

**Ideas.** `kind:idea` beads, always `execution:hitl`, so ralph's `bd ready -l execution:afk` never
returns them. A bare `bd ready` does — pass `--exclude-label kind:idea` when you want the
buildable view without ralph's filter.

**Where operational state lives.** Operational state — progress, what a stage learned, and the
branch, PR, commit or worktree refs — lives in bead fields, never in a scratch file: `bd note`
for the trail, the bead's own status for never-started/in-flight/done, and `bd provenance record`
for refs. A cold agent reads all of it from the bead. Durable, committable documents stay files —
`AGENTS.md`, `docs/`, `SKILL.md`, `REFERENCE.md`, playbooks, prompts — and are never migrated into
beads, because they are reviewed, diffed and versioned as text.

**`progress:` is for exceptions, never `stage:`.** `bd set-state <id> progress=blocked --reason "…"`
(or `progress=paused`) is the only state dimension to set, and only when the work stopped for a
reason a reader must know. It records an event bead and a `progress:` label, so a cold agent can
tell "stopped" from "never started" without reading prose. No `progress:` label means not an
exception: the status says never started, running, finished or deferred, and the trail says what
happened. Never set a `stage=` dimension: `bd set-state` removes the existing label for the
dimension it sets, so `bd set-state <id> stage=verify` deletes `stage:code` and rewrites the
chore's route. The reviewer handoff (`handoff.md`) and the working-docs artefact directory are
unchanged — they are files.

```bash
bd set-state agnt-ctx-abc.1 progress=blocked --reason "waiting on the upstream API key"
bd state agnt-ctx-abc.1 progress            # blocked
bd show agnt-ctx-abc.1.1                    # event bead: Reason: waiting on the upstream API key
bd label remove agnt-ctx-abc.1 progress:blocked   # unblock; the event bead stays as history
```

Quick reference:
- `bd ready` — list unblocked work
- `bd ready -l execution:afk` — work an agent can pick up (ralph's query)
- `bd list -l kind:idea` — the idea backlog
- `bd children <id>` — everything under a bead, closed included
- `bd create "Title" -p <0-3>` — create a task (P0 = critical); add `-l execution:<class>`,
  `--parent <id> --no-inherit-labels`, and `--validate`
- `bd update <id> --claim` — claim a task
- `bd note <id> "…"` — append a trail entry (append-only; `bd show <id>` reads it back)
- `bd set-state <id> progress=blocked --reason "…"` — record an exception (never `stage=`)
- `bd provenance record --issue <id> --kind … --source …` — bind a branch, PR, commit or worktree
- `bd close <id>` — complete a task
- `bd dep add <A> <B>` — **"A depends on B"** (B blocks A). First arg waits, second arg
  is waited-for. To express "X blocks Y", write `bd dep add Y X`.
- `bd dolt push` — sync to remote at session end
