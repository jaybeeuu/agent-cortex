# Stage Playbook: fixing

## Stage Instructions

1. Invoke `style-tests` before writing or updating tests.
2. Invoke `tdd` to drive any implementation or test changes.
3. Invoke `style-code` before making code changes.
4. Apply only the requested changes from the triggering feedback.
5. Do not perform unrelated modifications.
6. Preserve task scope and keep fixes minimal and explicit.

## Stage Outcome

- Commit and push the fix before reporting (see the stage-runner prompt, _Deliver before reporting_).
- Set `OUTCOME: SUCCESS` when requested changes are successfully applied.
- Set `OUTCOME: BLOCKED` if unable to apply changes or guidance is unclear.
- If blocked, list issues under `BLOCKING_ISSUES`.
- `FILES_CHANGED` lists files updated to address requested changes.

## Remediation and close

- You own this leaf bead: append notes, write the progress log, and `bd close <id> --reason=...`
  on both outcomes (see `prompts/stage-runner.md`).
- `OUTCOME: SUCCESS` — create nothing; closing this bead unblocks the fresh stage chore that
  was wired behind it.
- `OUTCOME: BLOCKED` — count the parent's existing `stage:fix` children against
  `maxFixRounds` in `skills/planning/create-task/pipeline.json`. Under cap, create another
  `stage:fix` chore carrying what remains **plus a fresh `stage:fix` chore** blocked on it
  (`bd dep add <fresh> <fix> --type blocks`) and leave the downstream re-run chore blocked on
  the fresh fix. At cap, block the parent and create nothing.
- Report `COMMIT`, `PUSHED`, and `PR` (`PR: none`).
