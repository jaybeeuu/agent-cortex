## Project context
<bd prime output — verbatim>

## Task
<bd show <id> output — verbatim>

## Dependency context
<summary of what prior completed beads delivered, if any>

## Relevant files
<list source files you read during context gathering>

## Progress log
Write progress to: `.agent-cortex/ralph/ralph-<bead-id>.log`
Log stage start, test results, build errors, and stage complete (see Progress Logging in run-beads skill).

## Instructions
Implement the task described above using a test-driven approach:

1. **Plan**: identify the discrete behaviors this task requires. List them before writing any code.
2. **Vertical slices only** — do not write all tests first. Work one behavior at a time:
   - Write one failing test (RED)
   - Write the minimal code to make it pass (GREEN)
   - Refactor if needed, keeping tests green
   - Repeat for the next behavior
3. **Tests must verify behavior through public interfaces** — not implementation details. A test should survive an internal refactor unchanged.
4. **Do not add speculative code** — only what is needed to pass the current test.
5. **Use context7** when working with any third-party library — fetch live docs to ensure you use the correct, up-to-date API for the version in this project.

Make only the changes required to complete this task — do not refactor unrelated code.

End your response with a ---REPORT--- block:
---REPORT---
BEAD_ID: <id>
STAGE_COMPLETED: coding
SUMMARY: <2–3 sentence summary of what was done>
FILES_CHANGED: <comma-separated list, or "none">
---
