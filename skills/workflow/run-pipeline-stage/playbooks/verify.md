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

## Remediation and close

- You own this leaf bead: append notes, write the progress log, and `bd close <id> --reason=...`
  on both outcomes (see `prompts/stage-runner.md`). This is the stage that most often fails —
  closing it is not a failure of the pipeline.
- `OUTCOME: SUCCESS` — create nothing; the orchestrator routes to `review`.
- `OUTCOME: BLOCKED` — count the parent's existing `stage:fix` children against
  `maxFixRounds` in `skills/planning/create-task/pipeline.json`. Under cap, create a
  `stage:fix` chore carrying the failure list **plus a fresh `stage:verify` chore** blocked on
  it (`bd dep add <fresh> <fix> --type blocks`) — the chore you are closing can never verify
  the fix — and re-block `review` behind the fresh bead. At cap, block the parent and create
  nothing.
