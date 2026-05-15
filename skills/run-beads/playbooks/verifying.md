# Stage Playbook: verifying

## Stage Instructions

1. Discover test/lint/check commands from project conventions (`package.json`, `Makefile`, language configs).
2. Run each discovered command in project root and capture output.
3. Do not fix failures in this stage — report only.

## Stage Outcome

- Set `VERIFY_OUTCOME: PASS` when all commands succeed.
- Set `VERIFY_OUTCOME: FAIL` when any command fails.
- If fail, summarize failures under `VERIFY_FAILURES`.
- `FILES_CHANGED` should be `none`.
