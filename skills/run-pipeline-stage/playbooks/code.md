# Stage Playbook: coding

## Stage Instructions

1. Invoke `style-tests` before writing tests.
2. Invoke `tdd` for the red-green-refactor implementation loop.
3. Invoke `style-code` before making code changes.
4. Do not add speculative code — only what is required by current tests/requirements.
5. Make only task-scoped changes; avoid unrelated refactors.
6. Use context7 for third-party libraries when API/version details matter.

## Stage Outcome

- Set `OUTCOME: SUCCESS` when implementation passes all tests and meets requirements.
- Set `OUTCOME: BLOCKED` if tests fail or requirements cannot be met.
- If blocked, list issues under `BLOCKING_ISSUES`.
- `FILES_CHANGED` lists all modified source/test files.
