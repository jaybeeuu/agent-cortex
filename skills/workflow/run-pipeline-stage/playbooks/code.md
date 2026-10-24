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

## Remediation and close

- You own this leaf bead: append notes, write the progress log, and `bd close <id> --reason=...`
  on both outcomes (see `prompts/stage-runner.md`).
- `OUTCOME: SUCCESS` — create nothing; the orchestrator routes to `verify`.
- `OUTCOME: BLOCKED` — count the parent's existing `stage:fix` children against
  `maxFixRounds` in `skills/planning/create-task/pipeline.json`. Under cap, create a
  `stage:fix` chore **plus a fresh `stage:code` chore** blocked on it (`bd dep add <fresh>
  <fix> --type blocks`), and re-block later stages behind the fresh bead. At cap, block the
  parent and create nothing.
