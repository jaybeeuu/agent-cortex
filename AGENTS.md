# AGENTS.md

Instructions for agents working on this repository.

## What This Repo Is

A personal collection of custom agents and skills, shipped to pi and Claude Code, plus PI
extensions and Claude hooks for enhancing the coding agent runtime. Changes here affect the
behaviour of every agent, skill, and PI extension available in the author's coding sessions.

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
  reaches `main` — bring a behind branch up to date by merging `main` in rather than rebasing it.
  `docs/commit-signing.md` records why squash is the only landing path that produces a signed
  commit; the rebase-versus-merge reasoning lives in the `git-workflow` skill.
- **Never block the main thread**: no `*Sync` functions (`readFileSync`, `spawnSync`, …).
  Tooling code in `bin/`, `scripts/`, `lib/`, `hooks/`, and `test/` must be async —
  enforced by `scripts/check-no-sync.mjs` (runs via `pnpm lint`). Skill-owned
  scripts (`skills/*/scripts`) and `extensions/` are the remaining sync surfaces.
- **Share generic tooling helpers in `scripts/lib/`**: tooling code (installers under
  `bin/installers/`, hooks, other scripts) imports shared utilities from `scripts/lib/`
  (e.g. `compose-agent.mjs`, `fs.mjs`) rather than redefining them inline.
- **`scripts/` is a runtime asset, not just build tooling**: `bin/agent-cortex.mjs` imports
  `scripts/lib/migrate.mjs` for `migrate`, and the installers import
  `scripts/lib/{compose-agent,fs}.mjs` — so any `package.json` `files` whitelist must include
  `scripts/`, or published installs and `migrate` break for consumers while every local run
  stays green.

## Skill Conventions

- **Skills are portable, not repo documentation.** `skills/` is installed onto arbitrary machines
  (pi, Claude Code), so it describes general practice and the author's portable
  preferences — never how this repository is configured or how to work in it. Facts about this
  checkout (branch bases, merge method, signature rules, required checks, release mechanics) belong
  in `AGENTS.md`, `docs/`, or the tracker. Repo-local `.agents/skills/` follows the same rule: a
  skill is a skill, not a place for this repo's configuration.
- `SKILL.md` must include a YAML front-matter block with `name` and `description`. `pnpm lint`
  enforces this (`pnpm check:skills`), because PI silently drops a skill whose frontmatter it
  cannot parse.
- `description` must be ≤ 1024 characters. First sentence: what it does. Second: "Use when…".
- Keep `SKILL.md` near the ~150-line target in `docs/skills/skill-anatomy.md`, overflowing into
  purpose-named support files (`REFERENCE.md`, `EXAMPLES.md`, `FORMAT.md`). `style-tests`
  deliberately sits at the top of that range rather than splitting — its principles must load
  automatically with the skill.
- Add utility scripts to `scripts/` when an operation is deterministic and would otherwise be
  regenerated each time (e.g. install scripts, scanners).
- Skill names use kebab-case and are grouped by prefix where related (e.g. `review-security`,
  `review-code`; `style-code`, `style-comms`, `style-documentation`).

## Agent Conventions

- Agents live in composable `<name>/` directories under `agents/`: a shared `agent.md` body plus
  per-harness subdirectories `pi/` and `claude/` (frontmatter.json and optional section files) per
  the spec in `agents/README.md`. `ralph`, `plan`, `ralph-plan`, and `strategy` all use the
  composable layout, and no flat agent file is committed — each harness renders its own at install
  time. The Claude plugin is materialised by the install-time generator
  `bin/installers/claude.mjs`: a plain `agent-cortex install claude` copies it into
  `~/.agent-cortex/claude` (skills copied flat with `{{TOOL:...}}`/`{{PATH:...}}` substituted,
  never symlinked), writes the marketplace manifest at
  `~/.agent-cortex/.claude-plugin/marketplace.json`, merges the committed `claude/settings.json`
  template into `~/.claude/settings.json`, and registers it with Claude Code via the
  `claude plugin` CLI. The settings merge preserves personal config: the CLI owns exactly
  `enabledPlugins` + `extraKnownMarketplaces`, and every other key is left untouched. Only
  that settings template is committed under `claude/` — the generated plugin subtree is not;
  hand-authored plugin extras live in `claude-extras/` (`.mcp.json`, `scripts/`), and
  `--output <dir>` is the generate-only form (tests/CI materialiser checks); every agent,
  `ralph` included, composes from its `claude/` harness dir).
- The pi package is materialised by `bin/installers/pi.mjs`: `agent-cortex install pi` stages a
  self-contained pi package in `~/.agent-cortex/pi` (manifest, flat rendered agents, token-substituted
  skills, a copy of `extensions/`, `token-map.json`, and the bundled `pi.packages` closure under
  `node_modules/`) and registers that directory with pi through the `pi` CLI — pi's own
  `~/.pi/agent/settings.json` is read, never written. `--output <dir>` stages only (no registration,
  no sweep) and `--dry-run` reports the plan. Once registration succeeds, a one-shot migration sweeps
  the copies the pre-staged-model installer rendered into `~/.pi/agent`, attributing them by name from
  the package root and recording completion in `~/.agent-cortex/legacy-sweep.json`; `~/.pi/agent/extensions`
  is never touched. Run it from the main checkout: the staged package is a snapshot of the checkout you
  invoked, so a run from a ralph worktree stages that worktree's content.
- Keep orchestration logic in the agent file; extract shared per-task workflow into a skill
  so it can be reused (e.g. ralph delegates per-task stage execution to `run-pipeline-stage`).

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

Quick reference:
- `bd ready` — list unblocked work
- `bd ready -l execution:afk` — work an agent can pick up (ralph's query)
- `bd list -l kind:idea` — the idea backlog
- `bd children <id>` — everything under a bead, closed included
- `bd create "Title" -p <0-3>` — create a task (P0 = critical); add `-l execution:<class>`,
  `--parent <id> --no-inherit-labels`, and `--validate`
- `bd update <id> --claim` — claim a task
- `bd close <id>` — complete a task
- `bd dep add <A> <B>` — **"A depends on B"** (B blocks A). First arg waits, second arg
  is waited-for. To express "X blocks Y", write `bd dep add Y X`.
- `bd dolt push` — sync to remote at session end
