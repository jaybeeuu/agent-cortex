# Stage Playbook: coding

## Stage Instructions

1. Invoke `implement-task` first. It reads the parent's `## Acceptance Criteria`, writes the
   criteria → evidence table before any code is touched, and holds the scope, boy-scout and
   mutation-check rules for the rest of the stage. A criterion with no check is a blocker: report
   `OUTCOME: BLOCKED` rather than guessing a proof.
2. It routes to `style-tests` before writing tests.
3. It routes to `tdd` for the red-green-refactor loop, one criterion at a time.
4. It routes to `style-code` before making code changes.
5. Do not add speculative code — only what is required by current tests/requirements.
6. Make only task-scoped changes; record out-of-scope findings as beads instead of editing them.
7. Use context7 for third-party libraries when API/version details matter.
8. Report the filled criteria → evidence table; the stage's requirements are the rows, not the
   diff.

## Stage Outcome

- Commit and push the stage's work before reporting (see the stage-runner prompt, _Deliver before reporting_).
- Set `OUTCOME: SUCCESS` when implementation passes all tests and meets requirements.
- Set `OUTCOME: BLOCKED` if tests fail or requirements cannot be met.
- If blocked, list issues under `BLOCKING_ISSUES`.
- `FILES_CHANGED` lists all modified source/test files.

## Remediation and close

- You own this leaf bead: record the trail entry through `scripts/trail-entry.mjs`, then
  `bd close <id> --reason=...` on both outcomes (see `prompts/stage-runner.md`, _Trail entries_).
- `OUTCOME: SUCCESS` — create nothing; the orchestrator routes to `verify`.
- `OUTCOME: BLOCKED` — count the parent's existing `stage:fix` children against
  `maxFixRounds` in `skills/planning/create-task/pipeline.json`. Under cap, create a
  `stage:fix` chore **plus a fresh `stage:code` chore** blocked on it (`bd dep add <fresh>
  <fix> --type blocks`), and re-block later stages behind the fresh bead. At cap, block the
  parent and create nothing.
- Report `COMMIT`, `PUSHED`, and `PR` (`PR: none` outside the document stage).
