# Create Task — Reference

Detail behind `skills/planning/create-task/SKILL.md`. The script (`scripts/create-chores.ts`) is the source of truth for this contract; this document mirrors it for verification.

## Script invocation

```
tsx create-chores.ts --parent <bead-id> [--priority <0-4>]
```

- Reads `<skill>/pipeline.json`; creates each stage chore via `bd create` and wires dependencies via `bd dep add`.
- Prints a JSON object mapping each stage ID to its chore bead ID, plus `featurePrReview` for the PR gate.

## Stage chore beads

One per stage in `pipeline.json` (currently `code`, `verify`, `review`, `document`):

- **Type**: `chore`
- **Title**: `[<parent-id>] <stage title>` (e.g. `[abc-123] Code`)
- **Labels**: `stage:<id>` (e.g. `stage:code`, `stage:verify`)
- **Dependencies**: `parent-child` to the parent bead; `blocks` between stages per each stage's `dependsOn` (the script requires `dependsOn` targets to appear earlier in `pipeline.json`).

## PR gate bead (`featurePrReview`)

- **Type**: `task`
- **Title**: `[<parent-id>] PR Review and Merge`
- **Labels**: `implementation-type:hitl`, `lifecycle:feature-pr`
- **Dependencies**: `parent-child` to the parent bead; `blocks` on the final document stage chore (`document`, falling back to the last stage in `pipeline.json`).
- **Purpose**: human review of the agent PR (agent branch → feature branch) before the feature closes.

## Current pipeline stages

| id | title | dependsOn |
|---|---|---|
| code | Code | — |
| verify | Verify | code |
| review | Review | verify |
| document | Document | review |

`maxFixRounds: 4` — the maximum fix-retry rounds allowed for a stage's verify loop before the PR gate. Adjust stages only in `pipeline.json`; the script and templates follow it.