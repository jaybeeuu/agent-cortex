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

- `FILES_CHANGED` lists docs touched, or `none` if no doc change is needed.
