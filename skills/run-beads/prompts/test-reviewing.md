## Project context
<bd prime output — verbatim>

## Task
<bd show <id> output — verbatim>

## Test files
<list of test files with their full content>

## Progress log
Write progress to: `.agent-cortex/ralph/ralph-<bead-id>.log`
Log stage start and stage complete (see Progress Logging in run-beads skill).

## Instructions
Compare the tests against the bead's acceptance criteria and requirements.
Determine whether all requirements are adequately covered by at least one test.

Do NOT look at the implementation — evaluate tests against requirements only.

End your response with a ---REPORT--- block:
---REPORT---
BEAD_ID: <id>
STAGE_COMPLETED: test-reviewing
SUMMARY: <2–3 sentence summary of coverage assessment>
FILES_CHANGED: none
TEST_REVIEW_OUTCOME: <DONE|NEEDS_MORE>
GAPS:              ← only if TEST_REVIEW_OUTCOME is NEEDS_MORE
- <uncovered requirement>
---
