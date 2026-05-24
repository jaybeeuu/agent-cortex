---
name: create-task
description: Create a bead, classify it, and if AFK expand it into pipeline stage child beads plus a HITL PR gate task. Use when creating a new task that should be tracked and moved through implementation and human review gates.
---

# Create Task

Create a bead, classify it via `classify-bead`, and — if AFK — expand it into child chore beads for each pipeline stage plus a child HITL PR gate task bead.

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

### 4. Expand into pipeline stage wisps

Run the `create-chores` script, which reads `pipeline.json` and deterministically creates all
stage chore wisps (ephemeral beads) in one shot:

```bash
pnpm --prefix skills/create-task/scripts exec tsx create-chores.ts \
  --parent <parent-id> \
  --priority <priority>
```

The script outputs a JSON object mapping stage IDs to wisp bead IDs, plus a HITL PR gate task bead ID, e.g.:

```json
{
  "code": "bd-wisp-abc123",
  "verify": "bd-wisp-def456",
  "review": "bd-wisp-ghi789",
  "document": "bd-wisp-jkl012",
  "featurePrReview": "bd-mno345"
}
```

Each wisp is created with:
- **type**: `chore`
- **Title pattern**: `[<parent-id>] <stage title>` (e.g. `[abc-123] Code`)
- **Labels**: `stage:<id>` (e.g. `stage:code`, `stage:verify`)
- **Dependencies**: `parent-child` to parent bead; `blocks` between stages per `dependsOn`

The PR gate bead is created with:
- **type**: `task`
- **Title**: `[<parent-id>] PR Review and Merge`
- **Labels**: `implementation-type:hitl`, `lifecycle:feature-pr`
- **Dependencies**: `parent-child` to parent bead; `blocks` on the final document stage chore
 - **Purpose**: human review of the agent PR (agent-branch → feature branch)

### 5. Report

Return the parent bead ID, classification (`AFK`), and the list of created child bead IDs (including `featurePrReview`).
