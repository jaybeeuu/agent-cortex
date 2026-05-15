# Stage Playbook: reviewing

## Stage Instructions

1. Invoke the `review-security` skill first.
2. If security verdict is FAIL:
   - set `REVIEW_OUTCOME: CHANGES_REQUESTED`,
   - include each finding under `CHANGES_REQUESTED`,
   - stop further review.
3. Otherwise review for correctness, requirement alignment, and material quality issues.
4. Do not request changes for stylistic preferences alone.

## Stage Outcome

- Set `REVIEW_OUTCOME: APPROVED|CHANGES_REQUESTED`.
- If changes requested, enumerate required changes under `CHANGES_REQUESTED`.
- `FILES_CHANGED` should be `none`.
