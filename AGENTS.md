# AGENTS.md

Instructions for agents working on this repository.

## What This Repo Is

A personal Copilot CLI plugin containing custom agents and skills, plus PI extensions for
enhancing the coding agent runtime. Changes here affect the behaviour of every agent, skill,
and PI extension available in the author's coding sessions.

## Structure

```
agent-cortex/
├── package.json           # PI package manifest (pi: { extensions, skills })
├── plugin.json            # GitHub Copilot plugin manifest — agents, skills, MCP servers
├── agents/                # Custom agents (*.agent.md, or <name>/ composable dirs)
│   ├── ralph.agent.md     #   flat format — live until the composer migration
│   └── ralph/             #   composable format — see agents/README.md
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
└── package.json          # PI package manifest (pi: { extensions, skills })
```

## Versioning

Use `pnpm changeset` for all version bumps. Never edit versions manually.
`package.json`, `plugin.json`, and `CHANGELOG.md` stay in lockstep automatically.
See the `style-versioning` skill for the full workflow.

## Changelog

Generated automatically by changesets. Do not edit `CHANGELOG.md` manually.

## Skill Conventions

- `SKILL.md` must include a YAML front-matter block with `name` and `description`.
- `description` must be ≤ 1024 characters. First sentence: what it does. Second: "Use when…".
- Keep `SKILL.md` under ~100 lines. Overflow into `REFERENCE.md` for rarely-needed detail.
- Add utility scripts to `scripts/` when an operation is deterministic and would otherwise be
  regenerated each time (e.g. install scripts, scanners).
- Skill names use kebab-case and are grouped by prefix where related (e.g. `review-security`,
  `review-code`; `style-code`, `style-comms`, `style-documentation`).

## Agent Conventions

- Agent files are named `<name>.agent.md` and live in `agents/`. Multi-harness agents may instead
  use a composable `<name>/` directory (`agent.md` shared body + per-harness `pi/`, `copilot/`,
  `claude/` frontmatter and section files) per the spec in `agents/README.md`.
- Keep orchestration logic in the agent file; extract shared per-task workflow into a skill
  so it can be reused (e.g. ralph delegates per-task stage execution to `run-pipeline-stage`).

## PI Extension Conventions

- PI extensions live in `extensions/`, one subdirectory per extension.
- Each extension directory contains `index.ts` (entrypoint) and `README.md` (usage).
- Extensions are auto-discovered when the repo is installed as a PI package via `pi install`.
- Keep extensions lightweight: no internal LLM calls. Extensions observe events and provide
  commands — they should not add token overhead.
- Extensions that persist data should write to `~/.pi/agent-cortex/` (global, cross-project)
  and tag records with the project path for per-project slicing.

## User preferences

Before making tooling or workflow decisions, read `docs/user-preferences.md` for the
user's personal development preferences (e.g. preferred package manager, tooling
choices). These preferences apply across all projects where this plugin is active.

## Task tracking

This project uses **bd (beads)** for task tracking.

Run `bd prime` at the start of each session for context.

Quick reference:
- `bd ready` — list unblocked work
- `bd create "Title" -p <0-3>` — create a task (P0 = critical)
- `bd update <id> --claim` — claim a task
- `bd close <id>` — complete a task
- `bd dep add <A> <B>` — **"A depends on B"** (B blocks A). First arg waits, second arg
  is waited-for. To express "X blocks Y", write `bd dep add Y X`.
- `bd dolt push` — sync to remote at session end
