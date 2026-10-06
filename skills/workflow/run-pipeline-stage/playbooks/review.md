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
6. Treat a test that asserts the static contents of a file — an expected config, markdown,
   terraform, or static snapshot — as a required change, not a stylistic preference: **the
   assertion does not prove the behaviour under test**. List it as a required change and set
   `REVIEW_OUTCOME: CHANGES_REQUESTED` (block the stage). This is distinct from a legitimate
   golden-output test whose expected value is a product of the behaviour under test — flag only
   the assertion that does not prove the behaviour.

## Stage Outcome

- Set `OUTCOME: SUCCESS` if approved.
- Set `OUTCOME: BLOCKED` if changes are requested.
- If blocked, enumerate required changes under `BLOCKING_ISSUES`.
- `FILES_CHANGED` should be `none`.
