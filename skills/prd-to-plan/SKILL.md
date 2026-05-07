---
name: prd-to-plan
description: Turn a PRD into a phased implementation plan stored as a bead. Use when user wants to break down a PRD, create an implementation plan, plan phases from a PRD, or mentions "tracer bullets".
---

# PRD to Plan

Break a PRD into a phased implementation plan using vertical slices (tracer bullets). The plan is stored in an epic bead's `design` field. Epics and tasks hang off it via `plan-to-epics`.

## Process

### 1. Confirm the PRD is in context

The PRD should already be in the conversation or referenced as a bead. If it isn't, ask the user to paste it or point you to the bead.

### 2. Explore the codebase

If you have not already explored the codebase, do so to understand the current architecture, existing patterns, and integration layers.

### 3. Identify durable architectural decisions

Before slicing, identify high-level decisions that are unlikely to change throughout implementation:

- Route structures / URL patterns
- Database schema shape
- Key data models
- Authentication / authorization approach
- Third-party service boundaries

These go in the plan bead so every epic can reference them.

### 4. Draft vertical slices

Break the PRD into **tracer bullet** phases. Each phase is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
- Do NOT include specific file names, function names, or implementation details likely to change
- DO include durable decisions: route paths, schema shapes, data model names
</vertical-slice-rules>

### 5. Quiz the user

Present the proposed breakdown as a numbered list. For each phase show:

- **Title**: short descriptive name
- **User stories covered**: which user stories from the PRD this addresses

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Should any phases be merged or split further?

Iterate until the user approves.

### 6. Create the plan bead

Create a top-level epic bead to hold the plan:

```bash
bd create "Plan: <Feature Name>" --type epic
```

Write the full phased breakdown into this bead's `design` field using the template below.

<plan-template>
## Source PRD

#<prd-bead-id>

## Architectural decisions

- **Routes**: ...
- **Schema**: ...
- **Key models**: ...

---

## Phase 1: <Title>

**User stories**: <list>

What to build: concise end-to-end description of this vertical slice.

Acceptance criteria:
- Criterion 1
- Criterion 2

---

## Phase 2: <Title>

...
</plan-template>

Once the plan bead is created, use the `plan-to-epics` skill to break it into epics.
