# AGENTS.md

Instructions for agents working on this repository.

## What This Repo Is

A personal Copilot CLI plugin containing custom agents and skills. Changes here affect the
behaviour of every agent and skill available in the author's Copilot CLI sessions.

## Structure

```
agent-cortex/
├── plugin.json           # Plugin manifest — name, version, skill/agent paths, MCP servers
├── agents/               # Custom agents (*.agent.md)
│   └── ralph.agent.md
└── skills/               # Skills (one directory per skill, each with a SKILL.md)
    ├── run-beads/
    │   ├── SKILL.md
    │   └── scripts/      # Utility scripts bundled with the skill
    └── review-security/
        ├── SKILL.md
        └── scripts/      # Utility scripts bundled with the skill
```

## Versioning

**Always bump `plugin.json` version** when making any change to agents or skills. Follow
semantic versioning:

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
- The plugin is installed from the GitHub repo — treat merged changes as released.
- Use `## Unreleased` only for unmerged work, and move entries to
  `## Released (@released@)` once merged.
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
  so it can be reused (e.g. ralph delegates per-bead workflow to `run-beads`).

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
