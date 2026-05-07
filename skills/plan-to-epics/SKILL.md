---
name: plan-to-epics
description: Convert a plan bead (from prd-to-plan) into epics (one per phase). Use when user wants to create epics from a plan, structure a plan into workstreams, or create the top-level bead breakdown from an implementation plan before tasking.
---

# Plan to Epics

Take an approved implementation plan bead (created by `prd-to-plan`) and create one epic per phase. Epics are the top-level grouping; individual tasks are created separately via the `epic-to-tasks` skill.

## Process

### 1. Locate the plan bead

Ask the user for the plan bead ID, or search `bd list` for beads with "Plan:" in the title if they haven't specified one.

### 2. Read the plan

Load the plan bead's `design` field. Note:

- The **architectural decisions** section (applies across all epics)
- Each **phase**: title, user stories covered, what to build, acceptance criteria

### 3. Map phases to epics

Each phase in the plan becomes one epic. If multiple phases clearly belong to the same workstream they may be merged — confirm with the user if so.

### 4. Quiz the user

Present the proposed epics as a numbered list. For each epic show:

- **Title**: from the plan phase
- **Summary**: one sentence describing the scope
- **Blocked by**: phases that must complete first (default: sequential order from the plan)

Ask the user:

- Should any phases be merged into a single epic, or split further?
- Are the dependency relationships correct, or can any epics run in parallel?

Iterate until the user approves.

### 5. Create the epics

Create epics in dependency order (blockers first) so you can reference real bead IDs.

```bash
bd create "Phase name" --type epic
```

Use the epic body template below for each epic's description, then wire up deps:

```bash
bd dep add <epic-id> <plan-bead-id>       # epic depends on plan
bd dep add <epic-id> <blocking-epic-id>   # sequential dependency if needed
```

<epic-template>
## Parent plan

#<plan-bead-id> — Phase <N>

## Summary

Concise scope and goal. Reference the plan bead rather than duplicating content.

## User stories covered

- User story N

## Blocked by

- #<epic-bead-id> (if any), or "None — can start immediately"
</epic-template>

Once epics are created, use the `epic-to-tasks` skill to break each epic into tasks.

