## Project context
<bd prime output — verbatim>

## Task
<bd show <id> output — verbatim>

## Files to update
<FILES_CHANGED from the previous coder/fixer's REPORT>

## Progress log
Write progress to: `.agent-cortex/ralph/ralph-<bead-id>.log`
Log stage start, test results, build errors, and stage complete (see Progress Logging in run-pipeline-stage skill).

## Instructions
Invoke the `style-code` skill before making any code changes.

Apply only the changes described in the Task section above. Do not make any other modifications.

**Use context7** when working with any third-party library — fetch live docs to ensure you use the correct, up-to-date API for the version in this project.

Commit and push the fix before reporting (see _Deliver before reporting_ in
`prompts/stage-runner.md`). A dirty worktree counts as a failed stage.

End your response with a ---REPORT--- block. The `run-pipeline-stage` skill's
`prompts/stage-runner.md` holds the authoritative REPORT contract — if this block and that
prompt differ, follow the prompt and correct this template.
---REPORT---
BEAD_ID: <id>
STAGE_COMPLETED: fix
SUMMARY: <2–3 sentence summary of what was changed>
FILES_CHANGED: <comma-separated list, or "none">
COMMIT: <sha of the stage commit, or "none">
PUSHED: <yes|no>
PR: none
OUTCOME: <SUCCESS|BLOCKED>
BLOCKING_ISSUES:         ← include only if OUTCOME is BLOCKED; one line per issue
- <what remains unresolved and what would unblock it>
---
