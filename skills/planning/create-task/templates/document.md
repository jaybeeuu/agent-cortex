## Project context
<bd prime output — verbatim>

## Task completed
<bead description — verbatim>

## What was implemented
<SUMMARY from the final coder/fixer REPORT>

## Files changed
<FILES_CHANGED from the final coder/fixer REPORT>

## Trail entry
Record one entry at stage start and one at stage close through the shared writer (see Trail Entries in the `run-pipeline-stage` skill):
```bash
node <run-pipeline-stage-scripts>/trail-entry.mjs \
  --bead <bead-id> --stage document --outcome <done|blocked|partial> \
  --evidence "<evidence>" --remaining "<what is left, or none>"
```
Evidence for a document stage: the files updated and the stage commit.

## Instructions
Invoke the `style-documentation` skill before making any documentation changes.

Review the changes made and compare them against the existing documentation in the repository.

1. Locate the project's `docs/` directory (or equivalent shared documentation space).
2. Read any existing docs relevant to the changes made.
3. Identify only the following worth documenting:
   - A key decision was made (why this approach over another)
   - Behaviour changed at a macro level (what the system now does that it didn't before)
   - A constraint or trade-off exists that a future engineer needs to know
4. If any of the above apply: update the most relevant existing doc. Only create a new file
   (`docs/decisions/<topic>.md`) if no suitable home exists.
5. If none of the above apply: do nothing. Leaving docs unchanged is the correct outcome
   when no decisions or macro behaviour changed.
6. Do not modify source code — documentation only.

Commit and push the docs, and open or update the feature PR before reporting (see _Deliver
before reporting_ in `prompts/stage-runner.md`). A dirty worktree counts as a failed stage.

End your response with a ---REPORT--- block. The `run-pipeline-stage` skill's
`prompts/stage-runner.md` holds the authoritative REPORT contract — if this block and that
prompt differ, follow the prompt and correct this template.
---REPORT---
BEAD_ID: <id>
STAGE_COMPLETED: document
SUMMARY: <2–3 sentence summary of what was documented, or "No documentation changes required">
FILES_CHANGED: <comma-separated list of docs touched, or "none">
COMMIT: <sha of the stage commit, or "none">
PUSHED: <yes|no>
PR: <feature PR url>
OUTCOME: <SUCCESS|BLOCKED>
BLOCKING_ISSUES:         ← include only if OUTCOME is BLOCKED; one line per issue
- <what blocks the stage and what would unblock it>
---
