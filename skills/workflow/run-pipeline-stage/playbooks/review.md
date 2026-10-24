# Stage Playbook: reviewing

## Stage Instructions

1. Invoke the `review-security` skill first.
2. If security verdict is FAIL:
   - set `OUTCOME: BLOCKED`,
   - include each finding under `BLOCKING_ISSUES`,
   - stop further review.
3. Invoke `style-code` and `style-tests` for code and test review criteria.
4. Review for correctness, requirement alignment, and material quality issues.
5. Do not request changes for stylistic preferences alone.

## Stage Outcome

- Set `OUTCOME: SUCCESS` if approved.
- Set `OUTCOME: BLOCKED` if changes are requested.
- If blocked, enumerate required changes under `BLOCKING_ISSUES`.
- `FILES_CHANGED` should be `none`.

## Remediation and close

- You own this leaf bead: append notes, write the progress log, and `bd close <id> --reason=...`
  on both outcomes (see `prompts/stage-runner.md`).
- `OUTCOME: SUCCESS` — create nothing; the orchestrator routes to `document`.
- `OUTCOME: BLOCKED` — count the parent's existing `stage:fix` children against
  `maxFixRounds` in `skills/planning/create-task/pipeline.json`. Under cap, create a
  `stage:fix` chore carrying the full `BLOCKING_ISSUES` list **plus a fresh `stage:review`
  chore** blocked on it (`bd dep add <fresh> <fix> --type blocks`), and re-block `document`
  behind the fresh bead. At cap, block the parent and create nothing.
