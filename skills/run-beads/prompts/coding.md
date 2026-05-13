## Project context
<bd prime output — verbatim>

## Task
<bd show <id> output — verbatim>

## Test files
<list of test files written during test-writing stage, with full content>

## Dependency context
<summary of what prior completed beads delivered, if any>

## Relevant files
<list source files you read during context gathering>

## Progress log
Write progress to: `.agent-cortex/ralph/ralph-<bead-id>.log`
Log stage start, test results, build errors, and stage complete (see Progress Logging in run-beads skill).

## Instructions
Make the provided tests pass with a minimal implementation.

Do not modify the test files. Do not add speculative code — only what is needed to pass the tests.
Make only the changes required to complete this task — do not refactor unrelated code.

End your response with a ---REPORT--- block:
---REPORT---
BEAD_ID: <id>
STAGE_COMPLETED: coding
SUMMARY: <2–3 sentence summary of what was done>
FILES_CHANGED: <comma-separated list, or "none">
---
