---
name: plan-to-beads
description: Convert a plan file (from ./plans/) into independently-grabbable beads. Use when user wants to create beads from a plan, turn a plan into beads, or file beads from an existing implementation plan.
---

# Plan to Beads

Take an approved implementation plan from `./plans/` and convert each phase into a bead. The plan has already been reviewed and sliced — your job here is to classify, group, and file.

## Process

### 1. Locate the plan

Ask the user which plan file to use, or list the files in `./plans/` if they haven't specified one.

### 2. Read the plan

Load the plan file. Note:

- The **architectural decisions** section (applies across all beads)
- Each **phase**: title, user stories covered, what to build, acceptance criteria

### 3. Classify phases as HITL or AFK

For each phase, determine:

- **AFK** — can be implemented and merged without human interaction
- **HITL** — requires a human checkpoint (design review, architectural decision, external dependency)

Prefer AFK. Flag HITL only when the phase genuinely cannot proceed autonomously.

### 4. Identify workstreams and draft epics

Group the phases into **workstreams** — coherent bodies of work with a shared goal (e.g. "Auth", "Data pipeline", "Admin UI").

- One workstream = one epic
- If all phases belong to one theme, one epic (or no epic) is fine
- Aim for <5 epics; more usually means the plan should have been split - flag it for user review and stop.

### 5. Quiz the user

Present the proposed breakdown as a numbered list. For each phase show:

- **Title**: from the plan
- **Epic**: which workstream this belongs to
- **Type**: HITL / AFK
- **Blocked by**: phases that must complete first (default: sequential order from the plan)

Ask the user:

- Does the epic grouping reflect the actual workstreams?
- Are the dependency relationships correct, or can any phases run in parallel?
- Should any phases be marked HITL / AFK differently?

Iterate until the user approves.

### 6. Create the beads

First, create an epic for each approved workstream:

```bash
bd create "Workstream name" --type epic
```

Then create the beads in dependency order (blockers first) so you can reference real bead numbers. Pass `--parent <epic-id>` for each bead.

Use the bead body template below.

<bead-template>
## Source plan

`./plans/<plan-filename>.md` — Phase <N>

## Epic

#<epic-bead-number> — <epic title>

## What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation. Reference the plan file rather than duplicating content.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Blocked by

- Blocked by #<bead-number> (if any)

Or "None - can start immediately" if no blockers.

## User stories addressed

Reference by identifier from the source plan:

- User story 3
- User story 7

</bead-template>

Do NOT modify the source plan file.
