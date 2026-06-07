---
name: bd-tool
description: Load project context and task state using the beads (bd) task tracker. Use when asked to work on a bead, pick up a task, or check what is available — or when the user mentions "beads", "bd", "bead", or "prime".
---

# bd-tool

This project uses **bd (beads)** for task tracking. This doc covers how we use it.

## First thing: `bd prime`

Always run this at the start of a session — it loads project context, conventions, and open tasks.

```bash
bd prime
```

Hold the full output in memory. Forward it verbatim to any subagents — never summarise it.

## Finding and claiming work

```bash
bd ready          # list unblocked tasks
bd show <id>      # view full description, labels, dependencies
bd update <id> --claim
```

## Labels

We use labels to track state. Key patterns:

| Label | Purpose | Example |
|---|---|---|
| `stage:<id>` | Pipeline stage for chore beads | `stage:code`, `stage:verify` |
| `implementation-type:<type>` | Who works it | `afk`, `hitl` |
| `lifecycle:<phase>` | Lifecycle gate | `feature-pr` |
| `epic:<id>` | Parent epic link | `epic:abc-123` |
| `priority:<level>` | Priority (0-3) | `priority:1` |

## Creating work

For new tasks with pipeline expansion:

```bash
# use the create-task skill, or manually:
bd create "<title>" -d "<description>" -p <0-3>
```

For dependencies:

```bash
bd dep add <id> <blocked-by-id> --type blocks
bd dep add <child-id> <parent-id> --type parent-child
```

## Completing work

```bash
bd close <id> --reason="Description of what was done"
```

Always add a reason (e.g. PR link).

## Syncing

```bash
bd dolt push
```

Optional — beads work locally. Sync at session end when it's convenient.

## Key conventions

- **Priority**: 0 = critical, 1 = high, 2 = medium, 3 = low
- **HITL beads**: require human action — do not claim or implement them. Inform the user.
- **Chore beads** (`--type chore --ephemeral`): auto-created pipeline stages. Do not create them manually — use `create-task`.

## Cross-skill references

| When you need… | Use this skill |
|---|---|
| Creating a new task with pipeline expansion | `create-task` |
| Executing a single pipeline stage | `run-pipeline-stage` |
| Running the full end-to-end pipeline | `ralph` |
| Classifying a bead's implementation type | `classify-bead` |
