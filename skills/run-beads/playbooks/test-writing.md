# Stage Playbook: test-writing

## Stage Instructions

1. Invoke the `style-code` skill before making any test changes.
2. Write a minimal set of fully failing tests for the **next uncovered requirement slice**.
3. Do not write all tests at once — cover one requirement slice per loop iteration.
4. Tests must verify behavior through public interfaces, not implementation details.
5. Do not write implementation code in this stage.

## Stage Outcome

- `TEST_REVIEW_OUTCOME` is not produced in this stage.
- `FILES_CHANGED` must list test files created/updated.
