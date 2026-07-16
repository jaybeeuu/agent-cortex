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

### 4. Expand into pipeline stage chores

Run the `create-chores` script, which reads `pipeline.json` and deterministically creates all
stage chores in one shot. They are plain (non-ephemeral) chores — `bd ready` must surface
them without `--include-ephemeral` for ralph to discover them:

```bash
# Run from the TARGET project's directory (cwd must be inside the target's
# .beads tree) — bd resolves its beads DB from cwd, not from the skill's
# location. Do NOT use `pnpm --prefix <scripts> exec`, which changes cwd to
# the scripts dir and makes bd pick the skill repo's own .beads instead of
# the target project's.
<skill-scripts>/node_modules/.bin/tsx \
  <skill-scripts>/create-chores.ts \
  --parent <parent-id> \
  --priority <priority>
```

Where `<skill-scripts>` is the absolute path to this skill's own `scripts/` directory —
resolve it from wherever this skill was actually loaded from (it varies by harness and
install location; e.g. a Claude Code plugin cache dir vs. a Copilot
`~/.copilot/installed-plugins/...` install vs. a local dev checkout). Do not hardcode
one harness's path.

The script outputs a JSON object mapping stage IDs to chore bead IDs, plus a HITL PR gate task bead ID, e.g.:

```json
{
  "code": "abc123",
  "verify": "def456",
  "review": "ghi789",
  "document": "jkl012",
  "featurePrReview": "bd-mno345"
}
```

Each stage chore is created with:
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
