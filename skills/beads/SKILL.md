---
name: beads
description: Load project context and task state using the beads (bd) task tracker. Use when starting a new session, picking up work, working on a task, or when the user mentions "beads", "bd", "bead", or "prime".
---

# Beads

## Set workspace context

Before any other beads command, set the MCP workspace context so the beads server knows which
project to operate on. Detect the git repository root and pass it as `workspace_root`:

```bash
git rev-parse --show-toplevel
```

Then call the `context` MCP tool with that path as `workspace_root`. Do this once per session —
all subsequent beads MCP calls will use it.

## Prime

Run `bd prime` and hold its full output in memory as your project context:

```bash
bd prime
```

`bd prime` outputs the project's tech stack, conventions, current goals, and open task list. Forward it verbatim to any subagents you spawn — never summarise it.

## Key commands

> There should be an MCP tool for any of the following commands, but if not, you can shell out to the CLI directly. Always prefer MCP tools if they exist.

```bash
bd ready                          # list unblocked tasks
bd show <id>                      # full description of a task
bd update <id> --claim            # claim a task before starting it
bd close <id>                     # mark a task complete
bd create "Title" -p <0-3>        # create a task (P0 = critical, P3 = low)
bd create "Title" --type epic     # create an epic to group a workstream
bd create "Title" --parent <id>   # create a task as a child of an epic
bd block <id> --on <other-id>     # declare a dependency
bd epic status                    # show completion progress across all epics
bd children <id>                  # list all child beads of an epic
bd dolt push                      # sync to remote at session end
```

## Epics

Use epics to group related tasks that belong to the same workstream. A workstream is a coherent body of work with a shared goal (e.g. "Authentication", "Data pipeline", "Admin UI"). Epics make it easy to track progress per workstream and understand how individual tasks relate to each other.

**When to create an epic:**
- You are breaking down a large feature or PRD into many tasks
- The tasks naturally cluster into 2 or more distinct workstreams
- You want to track the completion of a workstream as a unit

**How to use epics:**
1. Create the epic first: `bd create "Workstream name" --type epic`
2. Create child tasks with `--parent <epic-id>`
3. Check workstream progress with `bd epic status` or `bd children <epic-id>`

Tasks that do not clearly belong to any workstream can be created without a parent.

## Workflow

1. Run `bd prime` — hold the output as context for the session
2. Run `bd ready` — see what's available
3. Pick a task. Before claiming it, invoke the `classify-bead` skill to ensure it has an `implementation-type` label. If the bead is **HITL**, do not claim it — inform the user that it requires human action.
4. Claim the task with `bd update <id> --claim`
5. Implement it using the context from `bd prime` and `bd show <id>`
6. Close it with `bd close <id>`
7. Repeat from step 2
8. Sync at the end: `bd dolt push`
