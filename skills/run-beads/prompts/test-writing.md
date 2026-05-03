## Project context
<bd prime output — verbatim>

## Task
<bd show <id> output — verbatim>

## Existing tests (loop iteration 2+)
<list of existing test files and their content — omit on first iteration>

## Dependency context
<summary of what prior completed beads delivered, if any>

## Progress log
Write progress to: `.ralph-<bead-id>.log`
Log stage start and stage complete (see Progress Logging in run-beads skill).

## Instructions
Write a minimal set of fully failing tests for the NEXT uncovered requirement slice.

Do not write all tests at once — cover one slice of requirements per loop iteration.
Tests must be runnable: imports may reference paths that do not yet exist.
Do not write any implementation code.

End your response with a ---REPORT--- block:
---REPORT---
BEAD_ID: <id>
STAGE_COMPLETED: test-writing
SUMMARY: <2–3 sentence summary of what tests were written and which requirement slice they cover>
FILES_CHANGED: <comma-separated list of test files written>
---
