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
bd block <id> --on <other-id>     # declare a dependency
bd dolt push                      # sync to remote at session end
```

## Workflow

1. Run `bd prime` — hold the output as context for the session
2. Run `bd ready` — see what's available
3. Pick a task, claim it with `bd update <id> --claim`
4. Implement it using the context from `bd prime` and `bd show <id>`
5. Close it with `bd close <id>`
6. Repeat from step 2
7. Sync at the end: `bd dolt push`
