## Project context
<bd prime output — verbatim>

## Task
<bead description — verbatim>

## What was implemented
<SUMMARY from the coder/fixer's REPORT block>

## Files changed
<FILES_CHANGED from the coder/fixer's REPORT block>

## Progress log
Write progress to: `.agent-cortex/ralph/ralph-<bead-id>.log`
Log stage start, security scan result, review outcome, and stage complete (see Progress Logging in run-pipeline-stage skill).

## Instructions
**First**, invoke the `review-security` skill and run the scan against the changes. If the
verdict is FAIL, set `OUTCOME: BLOCKED` immediately and list each finding under
`BLOCKING_ISSUES` — do not proceed with the quality review.

**Then**, review the implementation for correctness, quality, and alignment with the task
description and project conventions. Only flag genuine correctness issues or clear deviations
from stated requirements — not stylistic preferences.

End your response with a ---REPORT--- block. The `run-pipeline-stage` skill's
`prompts/stage-runner.md` holds the authoritative REPORT contract — if this block and that
prompt differ, follow the prompt and correct this template.
---REPORT---
BEAD_ID: <id>
STAGE_COMPLETED: review
SUMMARY: <2–3 sentence summary of what you reviewed>
FILES_CHANGED: none
COMMIT: <sha, or "none" if this stage added no commit>
PUSHED: <yes|no>
PR: none
OUTCOME: <SUCCESS|BLOCKED>
BLOCKING_ISSUES:         ← include only if OUTCOME is BLOCKED; one numbered line per finding
1. <path:line — what is wrong and what to fix>
2. <path:line — what is wrong and what to fix>
---
