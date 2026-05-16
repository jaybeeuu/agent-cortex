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
