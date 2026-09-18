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

End your response with a ---REPORT--- block:
---REPORT---
BEAD_ID: <id>
STAGE_COMPLETED: fixing
SUMMARY: <2–3 sentence summary of what was changed>
FILES_CHANGED: <comma-separated list, or "none">
---
