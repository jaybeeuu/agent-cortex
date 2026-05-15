# Stage Playbook: coding

## Stage Instructions

1. Invoke the `style-code` skill before making any code changes.
2. Implement via TDD vertical slices:
   - one failing test (RED),
   - minimal implementation to pass (GREEN),
   - refactor while keeping tests green.
3. Do not add speculative code — only what is required by current tests/requirements.
4. Make only task-scoped changes; avoid unrelated refactors.
5. Use context7 for third-party libraries when API/version details matter.

## Stage Outcome

- `FILES_CHANGED` lists all modified source/test files.
