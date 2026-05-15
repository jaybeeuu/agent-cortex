# Stage Playbook: test-reviewing

## Stage Instructions

1. Evaluate tests against the bead requirements and acceptance criteria.
2. Do not review implementation code in this stage.
3. Decide whether requirements are fully covered:
   - `DONE` if coverage is sufficient.
   - `NEEDS_MORE` if any requirement slice is not covered.

## Stage Outcome

- Set `TEST_REVIEW_OUTCOME: DONE|NEEDS_MORE`.
- If `NEEDS_MORE`, list uncovered requirements under `GAPS`.
- `FILES_CHANGED` should be `none`.
