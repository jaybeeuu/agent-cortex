# Stage Playbook: test-reviewing

## Stage Instructions

1. Evaluate tests against the bead requirements and acceptance criteria.
2. Do not review implementation code in this stage.
3. Decide whether requirements are fully covered:
   - `SUCCESS` if coverage is sufficient.
   - `BLOCKED` if any requirement slice is not covered.

## Stage Outcome

- Set `OUTCOME: SUCCESS` if test coverage is sufficient.
- Set `OUTCOME: BLOCKED` if any requirement slice is uncovered.
- If blocked, list uncovered requirements under `BLOCKING_ISSUES`.
- `FILES_CHANGED` should be `none`.
