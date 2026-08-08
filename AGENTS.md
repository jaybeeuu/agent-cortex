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
├── agents/                # Custom agents (*.agent.md)
│   └── ralph.agent.md
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

**All version numbers must stay in lockstep.** When making any change to agents,
skills, or workflows, bump the version in **all three places**:

1. `plugin.json` → `"version"` field
2. `package.json` → `"version"` field
3. `CHANGELOG.md` → new `## X.Y.Z` header at the top

Follow semantic versioning:

| Change type | Bump |
|---|---|
| New skill or agent added | `minor` |
| Existing skill or agent meaningfully changed (new behaviour, new steps, restructured workflow) | `minor` |
| Bug fix or clarification with no behaviour change | `patch` |
| Breaking change (removed skill, renamed agent, incompatible workflow change) | `major` |

The version bump must be included in the same commit as the change — do not leave it for a
follow-up commit.

## Changelog

- Keep a root `CHANGELOG.md` for repository changes.
- When making any repo change (agents, skills, docs, scripts, or workflow rules), update
  `CHANGELOG.md` in the same commit.
- Write entries under a version header that matches the bumped `plugin.json` version
  (e.g. `## 0.40.0`). Add a new version section on every change.
- Keep entries user-facing and outcome-focused (what changed and why it matters).

## Skill Conventions

- `SKILL.md` must include a YAML front-matter block with `name` and `description`.
- `description` must be ≤ 1024 characters. First sentence: what it does. Second: "Use when…".
- Keep `SKILL.md` under ~100 lines. Overflow into `REFERENCE.md` for rarely-needed detail.
- Add utility scripts to `scripts/` when an operation is deterministic and would otherwise be
  regenerated each time (e.g. install scripts, scanners).
- Skill names use kebab-case and are grouped by prefix where related (e.g. `review-security`,
  `review-code`; `style-code`, `style-comms`, `style-documentation`).

## Agent Conventions

- Agent files are named `<name>.agent.md` and live in `agents/`.
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
