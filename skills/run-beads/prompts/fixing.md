## Project context
<bd prime output — verbatim>

## Task
<bead description — verbatim>

## Required changes (revision <N>)
<CHANGES_REQUESTED list from the reviewer's REPORT block>

## Files to update
<FILES_CHANGED from the previous coder/fixer's REPORT>

## Progress log
Write progress to: `.agent-cortex/ralph/ralph-<bead-id>.log`
Log stage start, test results, build errors, and stage complete (see Progress Logging in run-beads skill).

## Instructions
Apply only the changes listed above. Do not make any other modifications.

After applying all fixes, hand off to the **test-reviewing** stage.

End your response with a ---REPORT--- block:
---REPORT---
BEAD_ID: <id>
STAGE_COMPLETED: fixing
SUMMARY: <2–3 sentence summary of what was changed>
FILES_CHANGED: <comma-separated list, or "none">
---
