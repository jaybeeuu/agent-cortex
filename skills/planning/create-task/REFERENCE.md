# Create Task — Reference

Detail behind `skills/planning/create-task/SKILL.md`. The script (`scripts/create-chores.mjs`) is the source of truth for this contract; this document mirrors it for verification.

## Script invocation

```
node <skill-scripts>/create-chores.mjs --parent <bead-id> [--priority <0-4>]
```

- Reads `<skill>/pipeline.json`; creates each stage chore via `bd create` and wires dependencies via `bd dep add`.
- Prints a JSON object mapping each stage ID to its chore bead ID, plus `featurePrReview` for the PR gate.
- Expands a bead that already exists — it never creates a parent. It is also not idempotent: running it against a bead that already has stage chores creates a second chain, so callers check for existing `stage:*` children first (ralph's expansion guard).

## Stage chore beads

One per stage in `pipeline.json` (currently `code`, `verify`, `review`, `document`):

- **Type**: `chore`
- **Title**: `[<parent-id>] <stage title>` (e.g. `[abc-123] Code`)
- **Labels**: `stage:<id>` (e.g. `stage:code`, `stage:verify`)
- **Dependencies**: `parent-child` to the parent bead; `blocks` between stages per each stage's `dependsOn` (the script requires `dependsOn` targets to appear earlier in `pipeline.json`).

## PR gate bead (`featurePrReview`)

- **Type**: `task`
- **Title**: `[<parent-id>] PR Review and Merge`
- **Labels**: `execution:hitl`, `lifecycle:feature-pr` — exactly one `execution` label. The gate declares its own labels, so the script passes `--no-inherit-labels` and it never picks up the parent's `execution:afk`. Stage chores do **not** opt out; they keep inheriting `execution:afk` from the parent.
- **Parent contract**: the parent must carry `execution:afk`. Stage chores inherit the parent's labels, so a parent labelled `execution:hitl` (or unlabelled) produces a chore tree that no executor routes. The script does not classify — it only checks that it was given a parent ID.
- **Dependencies**: `parent-child` to the parent bead; `blocks` on the final document stage chore (`document`, falling back to the last stage in `pipeline.json`).
- **Purpose**: human review of the agent PR (agent branch → feature branch) before the feature closes.

## Hierarchy

Ownership is `--parent` at create time; ordering is `bd dep add`. The full shape for a
workstream, from container down to stage chore:

| Level | Type | Execution | Created by | Ownership |
|---|---|---|---|---|
| Feature | `feature` | `execution:hitl` | `create-task` step 5 | — |
| Planning bead ("Plan: <feature title>") | `task` | `execution:hitl` | `create-task` step 6 | `--parent <feature>` |
| Impl task (one per deliverable) | `task` | `execution:afk` | `create-task` step 6 | `--parent <feature>` |
| Stage chore | `chore` | inherited `execution:afk` | `create-chores.mjs` | `--parent <impl-task>` |
| PR gate | `task` | `execution:hitl` | `create-chores.mjs` | `--parent <impl-task>`, `--no-inherit-labels` |

Stage chores come from running `create-chores.mjs` once per impl task (`--parent <impl-task>`),
never against the feature itself — its parent must carry `execution:afk`.

Every impl task depends on the planning bead (`bd dep add <impl-task> <planning-bead>`), so
`bd ready` withholds them until planning closes. Nothing aggregates a child's execution class
onto its parent: the container is human-owned because a person decides when it is done, and
each child states the class of its own work.

### Planning bead body

Cold-start ready — another person picks it up with no chat history:

```markdown
## What and why

The deliverable this feature produces and the problem it solves.

## Decisions already made

- Decision — rationale

## Open questions / risks

- Question — who answers it

## References

- Bead IDs, files, docs consulted

## Acceptance Criteria

- [ ] The user confirms planning is sufficient for this feature.
```

## Current pipeline stages

| id | title | dependsOn |
|---|---|---|
| code | Code | — |
| verify | Verify | code |
| review | Review | verify |
| document | Document | review |

`maxFixRounds: 4` — the maximum fix-retry rounds allowed for a stage's verify loop before the PR gate. Adjust stages only in `pipeline.json`; the script and templates follow it.