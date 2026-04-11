---
name: epic-to-tasks
description: Break an epic bead into independently-grabbable task beads using tracer-bullet vertical slices. Use when user wants to task out an epic, break an epic into work items, or create the implementation tasks for a workstream.
---

# Epic to Tasks

Break an approved epic into individual task beads — thin vertical slices that can each be picked up and completed independently. Classify each task as HITL or AFK. The epic inherits its classification from its tasks.

## Process

### 1. Locate the epic

Ask the user for the epic bead number if not already in context. Fetch it from the bead tracker and read it in full.

### 2. Explore the codebase

If you have not already explored the relevant area of the codebase, do so to understand current structure, patterns, and integration layers before slicing.

### 3. Draft vertical slices

Break the epic into **tracer bullet** tasks. Each task is a thin vertical slice that cuts through ALL integration layers end-to-end — NOT a horizontal slice of one layer.

<vertical-slice-rules>
- Each task delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed task is demoable or verifiable on its own
- Prefer many thin tasks over few thick ones
</vertical-slice-rules>

### 4. Classify each task as HITL or AFK

- **AFK** — the agent can implement, verify, and merge the task autonomously. All acceptance criteria are machine-checkable.
- **HITL** — the task requires a human because at least one of the following is true:
  - The outcome cannot be verified by the agent (e.g. visual review, stakeholder sign-off, UX judgement)
  - The work requires manual action only a human can perform (e.g. credential setup, secrets management, external service configuration, infrastructure provisioning outside the codebase)
  - A decision must be made that the agent cannot make unilaterally (e.g. architectural choice between valid options, regulatory or legal sign-off)

Prefer AFK. Do not mark a task HITL just because it is complex — only when the agent genuinely cannot complete or verify it.

**Prefer decomposition over HITL classification.** Before marking a task HITL, ask: can it be split into smaller tasks where most are AFK and only a thin slice requires human involvement? Two common patterns:

- **Front-loaded HITL**: a human does a small prerequisite step (e.g. supplies credentials), then the agent completes the rest autonomously.
- **Trailing HITL**: the agent does the bulk of the work, and a human performs a final verification step (e.g. visual review, sign-off).

If either pattern applies, decompose rather than classifying the whole task HITL.

The **epic is AFK only if all its tasks are AFK**. If any task is HITL, the epic is HITL.

### 5. Quiz the user

Present the proposed tasks as a numbered list. For each task show:

- **Title**: short descriptive name
- **Type**: HITL / AFK
- **Blocked by**: which other tasks (if any) must complete first
- **Reason for HITL** (if applicable): which criterion applies

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any tasks be merged or split further?
- Are the HITL/AFK classifications correct?

Iterate until the user approves.

### 6. Create the tasks

Create tasks in dependency order (blockers first) so you can reference real bead numbers. Pass `--parent <epic-id>` for each task.

```bash
bd create "Task name" --parent <epic-id>
```

After creating each task, invoke the `classify-bead` skill on the new bead ID to apply the `implementation-type` label.

After all tasks are created, tag the parent epic to reflect the aggregate classification. If **any** task is HITL, the epic is HITL; otherwise it is AFK:

```bash
bd tag <epic-id> implementation-type:hitl   # if any task is HITL
bd tag <epic-id> implementation-type:afk    # if all tasks are AFK
```

Use the task body template below.

<task-template>
## Epic

#<epic-bead-number> — <epic title>

## What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation.

## Type

HITL / AFK

<!-- If HITL, state why: -->
<!-- HITL because: <unverifiable outcome / human-only action / unanswerable decision> -->

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Blocked by

- Blocked by #<bead-number> (if any)

Or "None - can start immediately" if no blockers.

</task-template>

Do NOT close or modify the parent epic.
