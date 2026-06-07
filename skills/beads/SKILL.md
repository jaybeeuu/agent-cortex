---
name: beads
description: Load project context and task state using the beads (bd) task tracker. Use when starting a new session, picking up work, working on a task, or when the user mentions "beads", "bd", "bead", or "prime".
---

# Beads

## When to use

- Starting a new session — load project context and see what is available.
- Recording work that needs to be done — create beads for tasks, epics for workstreams, and dependencies between them.
- Picking up work — find unblocked tasks and claim them.
- Working through a task — update status, track progress, and close when done.
- Planning with ralph — beads are the recording mechanism; create them rather than performing the work directly.
- The user mentions "beads", "bd", "bead", or "prime".

## When NOT to use

- Performing raw git operations or direct dolt commands — use the CLI directly.
- Tracking work in a different task system — beads is a local tool and does not sync to external trackers.
- One-off questions or exploratory sessions that do not produce tracked work.

## Philosophy / rationale

- **Context is the most expensive thing to rebuild.** `bd prime` captures project state, conventions, and goals so you do not lose your place between sessions.
- **Tracked work beats remembered work.** A bead captures what needs doing, why, and what blocks it. Writing it down means you can switch context and come back without losing the thread.
- **Beads are a local tool.** They work for you, not for a team or a CI pipeline. Sync when it is useful; skip it when it is not.

## Workflow

### 1. Prime

```bash
bd prime
```

Hold the full output in memory as your project context. It contains tech stack, conventions, current goals, and the open task list. Forward it verbatim to any subagents you spawn — never summarise it. This is the only setup you need — `bd` detects the project from the working directory automatically.

### 2. Identify the bead

If you were passed a bead ID, show it:

```bash
bd show <id>
```

If you need to find work, list unblocked tasks:

```bash
bd ready
```

Review descriptions with `bd show <id>` to understand what each one needs.

### 3. Claim

```bash
bd update <id> --claim
```

### 4. Implement

Use the context from `bd prime` and `bd show <id>` to complete the work.

### 5. Close

```bash
bd close <id>
```

Add a reason when it is meaningful (e.g. PR link).

## Red Flags

- **Skipping `bd prime`.** Without it you lose project-level context — tech stack, conventions, goals. Always run it at session start.
- **Claiming a HITL bead without informing the user.** HITL means the task needs a human. Claiming it blocks progress until you hand off.
- **Working without beads. Even a single task should be tracked. Every untracked task is a bead that will be re-created later when someone forgets it was done.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I will just do this one task without creating a bead" | Untracked work is invisible work. Creating a bead takes ten seconds. |
| "I will just do the work directly instead of recording it as a bead" | Especially during ralph-plan: beads are the recording mechanism. Creating a bead means ralph can execute it later. Doing the work directly bypasses the pipeline. |
| "I will sync later" | Syncing is optional — beads work fine as a purely local tool. If you do sync, do it at session end when it is easy to remember what changed. |
| "I already know what to do — I do not need `bd ready`" | `bd ready` also shows blocked tasks and priorities. You may be picking the wrong thing. |

## Cross-skill references

| When you need… | Use this skill |
|---|---|
| Creating a new task with classification and pipeline expansion | `create-task` |
| Executing a single pipeline stage | `run-beads` |
| Running the full end-to-end pipeline | `ralph` |

## Examples

### Full session walkthrough

```
$ bd prime
  → loads project conventions, goals, and open tasks

$ bd show agnt-ctx-abc123
  → reads the full description

$ bd update agnt-ctx-abc123 --claim

# implement... then:
$ bd close agnt-ctx-abc123 --reason="Implemented in PR #42"
```

## Verification checklist

- [ ] `bd prime` run at session start
- [ ] HITL beads handed off to the user, not claimed
- [ ] All completed tasks closed with a reason
