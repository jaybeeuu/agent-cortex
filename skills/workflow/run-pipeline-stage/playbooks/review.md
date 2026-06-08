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
