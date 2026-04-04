---
name: prd-to-epics
description: Break a PRD into epics (one per workstream) using tracer-bullet vertical slices. Use when user wants to convert a PRD to epics, structure a PRD into workstreams, or create the top-level breakdown of a PRD before tasking.
---

# PRD to Epics

Break a PRD into epics — one per workstream. Epics are the top-level grouping of work; individual tasks are created separately via the `epic-to-tasks` skill.

## Process

### 1. Locate the PRD

Ask the user for the PRD bead number (or URL).

If the PRD is not already in your context window, fetch it from the bead tracker.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code.

### 3. Identify workstreams

Identify the distinct **workstreams** in the PRD — coherent bodies of work with a shared goal (e.g. "Authentication", "Data pipeline", "Admin UI").

- One workstream = one epic.
- If all the work clearly belongs to one theme, one epic (or no epic) is fine.
- Aim for <5 epics; more than that usually signals the PRD needs splitting.

### 4. Quiz the user

Present the proposed epics as a numbered list. For each epic show:

- **Title**: short descriptive name
- **Summary**: one sentence describing the scope
- **User stories covered**: which user stories from the PRD this addresses
- **Blocked by**: which other epics (if any) must complete first

Ask the user:

- Does the epic grouping reflect the actual workstreams? Should any epics be merged or split?
- Are the dependency relationships correct?

Iterate until the user approves.

### 5. Create the epics

Create epics in dependency order (blockers first) so you can reference real bead numbers.

```bash
bd create "Workstream name" --type epic
```

Use the epic body template below.

<epic-template>
## Parent PRD

#<prd-bead-number>

## Summary

A concise description of this workstream. Describe the scope and goal, not implementation details. Reference specific sections of the parent PRD rather than duplicating content.

## User stories covered

Reference by number from the parent PRD:

- User story 3
- User story 7

## Blocked by

- Blocked by #<epic-bead-number> (if any)

Or "None - can start immediately" if no blockers.

</epic-template>

Do NOT close or modify the parent PRD bead.

Once epics are created, use the `epic-to-tasks` skill to break each epic into tasks.

