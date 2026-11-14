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

Hold the full output for your own context. Subagents can run `bd prime` themselves if they need project context.

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
| `execution:<class>` | Who works it — `afk` is agent-routable, `hitl` needs a human | `afk`, `hitl` |
| `kind:idea` | Unscoped backlog idea, always `execution:hitl` | `kind:idea` |
| `lifecycle:<phase>` | Lifecycle gate | `feature-pr` |
| `epic:<id>` | Parent epic link | `epic:abc-123` |
| `priority:<level>` | Priority (0-3) | `priority:1` |
| `defect:<class>` | The kind of defect a review rejection names — one per rejection, closed list, never the whole message | `defect:test-unproven` |

## Where operational state lives

Operational state lives in bead fields, not in files: progress, what a stage learned, the
decisions taken, and the branch, PR, commit or worktree refs. A cold agent reads all of it from
the bead.

| State | Home |
|---|---|
| What a stage did, and what it learned | `bd note <id> "…"` — an append-only trail |
| Status: never started, in flight, blocked, paused, done | the bead's own status — `bd statuses` |
| A decision and its reason | `bd note <id> "…"` — the same trail |
| Branch, PR, commit, worktree | `bd provenance record --issue <id> …` |
| Reviewer handoff prose | `.agent-cortex/working-docs/hitl/<bead-id>/handoff.md` — unchanged |
| Screenshots, logs, repro scripts | the bead's working-docs directory — unchanged |

Durable, committable documents stay files: `SKILL.md`, `REFERENCE.md`, playbooks, prompts,
`docs/`, `AGENTS.md`. Never migrate those into beads — they are reviewed, diffed and versioned as
text. A scratch file for progress is wrong twice: it duplicates the bead, and no other agent finds
it.

### Use the built-in statuses; add no state labels

`bd statuses` lists the seven statuses the tracker owns, and they already answer "where is this
work?": `open` never started, `in_progress` being worked on, `blocked` stopped with no bead to
wait on, `deferred` stopped on purpose, `closed` finished, and `pinned`/`hooked` parked by the
tracker. A label such as `progress:blocked` repeats a status and splits the answer across two
places, so do not add one.

A stop that needs a human decision becomes a bead, not a label: create the decision bead
(`execution:hitl`, the question in its title) and depend the waiting bead on it. The waiting bead
leaves `bd ready`, and the decision shows up as work a human can take. Use `--status blocked` only
when no bead can carry the blocker — a fix-round cap, an outage. Record the stop and its reason
with `bd note`, which appends, so the trail keeps every checkpoint in order.

```text
$ bd create "Decide: which upstream API do we call?" -t task -l execution:hitl
✓ Created issue: probe-3i4 — Decide: which upstream API do we call?
$ bd dep add probe-ijd probe-3i4         # probe-ijd waits on the decision
✓ Added dependency: probe-ijd (Rate-limit the export endpoint) depends on probe-3i4 (…) (blocks)
$ bd ready                               # only the decision bead is ready now
○ probe-3i4 P2 Decide: which upstream API do we call?
$ bd note probe-ijd "[2026-11-14T08:26:38Z] stopped: API choice open; decision bead filed"
✓ Note added to probe-ijd — Rate-limit the export endpoint
```

**Never set a state dimension.** `bd set-state` writes a label for a dimension and removes the
label it replaces, so `bd set-state <id> stage=verify` deletes `stage:code` and rewrites the
bead's route. Statuses and notes cover every case above, so no dimension is needed.

### `defect:<class>` classifies a defect; it is not a state

A review rejection carries one class from the closed list in
[review-defects](../../review/review-defects/SKILL.md), which owns how to apply, remove and query it.

## Creating work

For new tasks with pipeline expansion:

```bash
# use the create-task skill, or manually:
bd create "<title>" -d "<description>" -p <0-3> --validate
```

For parent-child relationships (create with `--parent`):

```bash
bd create "<title>" --parent <parent-id> -d "<description with the type's required section>" --validate
```

For blocking dependencies between beads:

```bash
bd dep add <id> <blocked-by-id> --type blocks
```

### Required sections

Create substantive beads with `--validate` so a section-less bead is rejected before it is
recorded. `bd create --validate` requires these sections per type (matching is case-insensitive);
`bd lint` checks the same contract on existing beads and exits non-zero when any are missing:

| Type | Required sections |
|---|---|
| `task`, `feature` | `## Acceptance Criteria` |
| `epic` | `## Success Criteria` |
| `bug` | `## Steps to Reproduce`, `## Acceptance Criteria` |
| `chore` | none |

Plan what you write: the type's required sections are the target of the planning interview
(`write-a-prd`, `request-refactor-plan`, `plan`, `grill-me`, …). Do not invent section content —
surface an assumption and confirm it with the human. Chore beads carry no required sections; their
description should reference the parent/requirements bead rather than restating criteria.

Review after creating — lint the beads you just made and fix any flagged ones:

```bash
bd lint <new-id>...      # scoped to your beads; exits non-zero on missing sections
bd lint                  # the whole open backlog (may flag pre-existing beads)
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

- **Priority**: 0 = critical, 1 = high, 2 = medium, 3 = low, 4 = backlog. Aliased as P0-P4.
- **`execution:afk` / `execution:hitl`**: the execution axis, and a query filter only — no
  auto-claim. `bd ready -l execution:afk` is the agent-workable view; an `execution:hitl` bead
  needs a human, so do not claim or implement it. Inform the user.
- **Idea beads** (`kind:idea`): an open, unscoped idea (`execution:hitl`) that is promoted to an
  epic once fleshed out. They stay `open` and carry no `execution:afk`, so a scoped
  `bd ready -l execution:afk` view never lists them — but a bare `bd ready` does. Filter a
  plain ready listing with `bd ready --exclude-label kind:idea`.
- **Chore beads** (`--type chore`): auto-created pipeline stages. Do not create them manually — use `create-task`. Not ephemeral — they must stay visible to plain `bd ready` for ralph to discover them.

## See Also

- [create-task](../../planning/create-task/SKILL.md) — creating a task that needs pipeline expansion.
- [classify-bead](../../planning/classify-bead/SKILL.md) — resolving a bead's execution class.
- [run-pipeline-stage](../../workflow/run-pipeline-stage/SKILL.md) — executing a single pipeline stage for a claimed bead.
- [ralph](../../workflow/ralph/SKILL.md) — running the whole ready backlog end to end.
