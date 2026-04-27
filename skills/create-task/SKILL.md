---
name: create-task
description: Create a bead, classify it, and if AFK expand it into pipeline stage child beads. Use when creating a new task that should be tracked and potentially broken into implementation stages.
---

# Create Task

Create a bead, classify it via `classify-bead`, and — if AFK — expand it into child chore beads for each pipeline stage.

## Inputs

| Parameter   | Required | Description                          |
|-------------|----------|--------------------------------------|
| title       | yes      | Task title                           |
| description | yes      | Task description                     |
| priority    | no       | 0–3 (default 2)                      |
| parent      | no       | Parent bead ID for `parent-child` dep |

## Procedure

### 1. Create the bead

```bash
bd create "<title>" --description "<description>" --priority <priority>
```

If a `parent` was provided, add a `parent-child` dependency:

```bash
bd dep add <new-id> <parent> --type parent-child
```

Record the new bead ID.

### 2. Classify the bead

Invoke the `classify-bead` skill on the new bead (as a subagent per that skill's invocation instructions). It returns `AFK` or `HITL`.

### 3. Branch on classification

**If HITL**: stop. Report the bead ID and classification to the caller. No further action.

**If AFK**: continue to step 4.

### 4. Expand into pipeline stage beads

Read `pipeline.json` from this skill's directory (`skills/create-task/pipeline.json`).

For each stage in the `stages` array, create a child chore bead:

```bash
bd create "[<parent-id>] <stage.title>" \
  --type chore \
  --description "<stage.description>" \
  --priority <same as parent>
bd tag <child-id> stage:<stage.id>
bd dep add <child-id> <parent-id> --type parent-child
```

**Dependency chaining**: each stage lists a `dependsOn` array of stage IDs. For each entry, add a `blocks` dependency from the referenced stage's child bead to the current stage's child bead:

```bash
bd dep add <current-child-id> <depended-on-child-id> --type blocks
```

This ensures stages execute in the order defined by the pipeline.

### Child bead conventions

- **issue_type**: `chore`
- **Title pattern**: `[<parent-id>] <stage title>` (e.g. `[abc-123] Code`)
- **Labels**: `stage:<id>` (e.g. `stage:code`, `stage:verify`)
- **Dependencies**: `parent-child` to parent bead; `blocks` between stages per `dependsOn`

### 5. Report

Return the parent bead ID, classification (`AFK`), and the list of child bead IDs with their stage labels.
