# Stage Playbook: documenting

## Stage Instructions

1. Invoke the `style-documentation` skill before making documentation changes.
2. Update docs only when changes introduce:
   - a key decision,
   - macro-level behavior change,
   - a lasting constraint/trade-off.
3. Prefer updating existing docs; create new docs only when no suitable home exists.
4. Do not modify source code in this stage.

## Stage Outcome

- Set `OUTCOME: SUCCESS` when docs are updated as needed (or none needed).
- Set `OUTCOME: BLOCKED` if unable to update or content guidance is unclear.
- If blocked, list issues under `BLOCKING_ISSUES`.
- `FILES_CHANGED` lists docs touched, or `none` if no doc change is needed.

## Remediation and close

- You own this leaf bead: append notes, write the progress log, and `bd close <id> --reason=...`
  on both outcomes (see `prompts/stage-runner.md`).
- `OUTCOME: SUCCESS` — create nothing; the orchestrator opens the feature PR and updates the
  HITL gate bead.
- `OUTCOME: BLOCKED` — count the parent's existing `stage:fix` children against
  `maxFixRounds` in `skills/planning/create-task/pipeline.json`. Under cap, create a
  `stage:fix` chore **plus a fresh `stage:document` chore** blocked on it
  (`bd dep add <fresh> <fix> --type blocks`) so documentation is retried after the fix. At cap,
  block the parent and create nothing.
