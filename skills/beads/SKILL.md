---
name: beads
description: Load project context and task state using the beads (bd) task tracker. Use when starting a new session, picking up work, working on a task, or when the user mentions "beads", "bd", "bead", or "prime".
---

# Beads

## Prime first

At the start of every session, run `bd prime` and hold its full output in memory as your project context:

```bash
bd prime
```

`bd prime` outputs the project's tech stack, conventions, current goals, and open task list. Forward it verbatim to any subagents you spawn — never summarise it.

## Key commands

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
3. Pick a task, claim it with `bd update <id> --claim`
4. Implement it using the context from `bd prime` and `bd show <id>`
5. Close it with `bd close <id>`
6. Repeat from step 2
7. Sync at the end: `bd dolt push`
