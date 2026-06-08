# Stage Playbook: fixing

## Stage Instructions

1. Invoke `style-tests` before writing or updating tests.
2. Invoke `tdd` to drive any implementation or test changes.
3. Invoke `style-code` before making code changes.
4. Apply only the requested changes from the triggering feedback.
5. Do not perform unrelated modifications.
6. Preserve task scope and keep fixes minimal and explicit.

## Stage Outcome

- Set `OUTCOME: SUCCESS` when requested changes are successfully applied.
- Set `OUTCOME: BLOCKED` if unable to apply changes or guidance is unclear.
- If blocked, list issues under `BLOCKING_ISSUES`.
- `FILES_CHANGED` lists files updated to address requested changes.
