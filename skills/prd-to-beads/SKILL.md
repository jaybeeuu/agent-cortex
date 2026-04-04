---
name: prd-to-beads
description: Break a PRD into independently-grabbable beads using tracer-bullet vertical slices. Use when user wants to convert a PRD to beads, create implementation tickets, or break down a PRD into work items.
---

# PRD to Beads

Break a PRD into independently-grabbable beads using vertical slices (tracer bullets).

## Process

### 1. Locate the PRD

Ask the user for the PRD bead number (or URL).

If the PRD is not already in your context window, fetch it from the bead tracker.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code.

### 3. Identify workstreams and draft epics

Before slicing into individual beads, identify the distinct **workstreams** in the PRD — coherent bodies of work with a shared goal (e.g. "Authentication", "Data pipeline", "Admin UI").

- A workstream should map to a single epic.
- If all the work clearly belongs to one theme, one epic (or no epic) is fine.
- Aim for <5 epics; more than that usually signals the PRD needs splitting.

Present the proposed epics to the user and confirm before proceeding. You will create the epics in step 6 so each bead can be assigned a real parent ID.

### 4. Draft vertical slices

Break the PRD into **tracer bullet** beads. Each bead is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

Slices may be 'HITL' or 'AFK'. HITL slices require human interaction, such as an architectural decision or a design review. AFK slices can be implemented and merged without human interaction. Prefer AFK over HITL where possible.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
</vertical-slice-rules>

### 5. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **Epic**: which workstream this belongs to
- **Type**: HITL / AFK
- **Blocked by**: which other slices (if any) must complete first
- **User stories covered**: which user stories from the PRD this addresses

Ask the user:

- Does the epic grouping reflect the actual workstreams? Should any epics be merged or split?
- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any slices be merged or split further?
- Are the correct slices marked as HITL and AFK?

Iterate until the user approves the breakdown.

### 6. Create the beads

First, create an epic for each approved workstream:

```bash
bd create "Workstream name" --type epic
```

Then create the beads. Use the bead body template below.

Create beads in dependency order (blockers first) so you can reference real bead numbers in the "Blocked by" field. Pass `--parent <epic-id>` for each bead so it is grouped under the correct workstream.

<bead-template>
## Parent PRD

#<prd-bead-number>

## Epic

#<epic-bead-number> — <epic title>

## What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation. Reference specific sections of the parent PRD rather than duplicating content.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Blocked by

- Blocked by #<bead-number> (if any)

Or "None - can start immediately" if no blockers.

## User stories addressed

Reference by number from the parent PRD:

- User story 3
- User story 7

</bead-template>

Do NOT close or modify the parent PRD bead.
