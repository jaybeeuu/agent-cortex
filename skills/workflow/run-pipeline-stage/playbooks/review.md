# Stage Playbook: reviewing

## Stage Instructions

1. Invoke the `review-security` skill first.
2. If security verdict is FAIL:
   - set `OUTCOME: BLOCKED`,
   - include each finding under `BLOCKING_ISSUES`,
   - stop further review.
3. Invoke `style-code` and `style-tests` for code and test review criteria.
4. Review for correctness, requirement alignment, and material quality issues.
5. Read the name of every changed test, then find the assertion that proves each clause of it. A
   count in the name needs a count assertion, a state needs that state, and a "not" needs the
   absence. Reject the test when any clause has no assertion, and name the missing clause under
   `BLOCKING_ISSUES`.
6. Say in the `SUMMARY` whether the mutation check from `style-tests` was run. A branch that adds
   or changes a test owes that check whether or not the bead asked for it. Block when the branch
   shows no evidence that it ran.
7. Do not request changes for stylistic preferences alone.

## Stage Outcome

- Set `OUTCOME: SUCCESS` if approved.
- Set `OUTCOME: BLOCKED` if changes are requested.
- If blocked, enumerate required changes under `BLOCKING_ISSUES`.
- `FILES_CHANGED` should be `none`.

## Remediation and close

- You own this leaf bead: record the trail entry through `scripts/trail-entry.mjs`, then
  `bd close <id> --reason=...` on both outcomes (see `prompts/stage-runner.md`, _Trail entries_).
- `OUTCOME: SUCCESS` — create nothing; the orchestrator routes to `document`.
- `OUTCOME: BLOCKED` — count the parent's existing `stage:fix` children against
  `maxFixRounds` in `skills/planning/create-task/pipeline.json`. Under cap, create a
  `stage:fix` chore carrying the full `BLOCKING_ISSUES` list **plus a fresh `stage:review`
  chore** blocked on it (`bd dep add <fresh> <fix> --type blocks`), and re-block `document`
  behind the fresh bead. At cap, block the parent and create nothing.
