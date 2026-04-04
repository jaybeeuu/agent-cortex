---
name: plan-to-epics
description: Convert a plan file (from ./plans/) into epics (one per phase). Use when user wants to create epics from a plan, structure a plan into workstreams, or create the top-level bead breakdown from an implementation plan before tasking.
---

# Plan to Epics

Take an approved implementation plan from `./plans/` and create one epic per phase. Epics are the top-level grouping; individual tasks are created separately via the `epic-to-tasks` skill.

## Process

### 1. Locate the plan

Ask the user which plan file to use, or list the files in `./plans/` if they haven't specified one.

### 2. Read the plan

Load the plan file. Note:

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

Create epics in dependency order (blockers first) so you can reference real bead numbers.

```bash
bd create "Phase name" --type epic
```

Use the epic body template below.

<epic-template>
## Source plan

`./plans/<plan-filename>.md` — Phase <N>

## Summary

A concise description of this phase. Describe the scope and goal, not implementation details. Reference the plan file rather than duplicating content.

## Blocked by

- Blocked by #<epic-bead-number> (if any)

Or "None - can start immediately" if no blockers.

</epic-template>

Do NOT modify the source plan file.

Once epics are created, use the `epic-to-tasks` skill to break each epic into tasks.

