# Stage Playbook: verifying

## Stage Instructions

1. Discover test/lint/check commands from project conventions (`package.json`, `Makefile`, language configs).
2. Run each discovered command in project root and capture output.
3. Do not fix failures in this stage — report only.

## Stage Outcome

- Set `OUTCOME: SUCCESS` when all commands succeed.
- Set `OUTCOME: BLOCKED` when any command fails.
- If blocked, summarize failures under `BLOCKING_ISSUES`.
- `FILES_CHANGED` should be `none`.
