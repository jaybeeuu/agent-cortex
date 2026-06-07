# Stage Playbook: fixing

## Stage Instructions

1. Invoke the `style-code` skill before making any code changes.
2. Apply only the requested changes from the triggering feedback.
3. Do not perform unrelated modifications.
4. Preserve task scope and keep fixes minimal and explicit.

## Stage Outcome

- Set `OUTCOME: SUCCESS` when requested changes are successfully applied.
- Set `OUTCOME: BLOCKED` if unable to apply changes or guidance is unclear.
- If blocked, list issues under `BLOCKING_ISSUES`.
- `FILES_CHANGED` lists files updated to address requested changes.
