# Per-Stage Prompt Templates

All prompts must include the `bd prime` output verbatim. Tailor the rest per stage.

## Coding Prompt

```
## Project context
<bd prime output — verbatim>

## Task
<bd show <id> output — verbatim>

## Dependency context
<summary of what prior completed beads delivered, if any>

## Relevant files
<list source files you read during context gathering>

## Progress log
Write progress to: `.ralph-<bead-id>.log`
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

Make only the changes required to complete this task — do not refactor unrelated code.

End your response with a ---REPORT--- block:
---REPORT---
BEAD_ID: <id>
STAGE_COMPLETED: coding
SUMMARY: <2–3 sentence summary of what was done>
FILES_CHANGED: <comma-separated list, or "none">
---
```

## Reviewing Prompt

```
## Project context
<bd prime output — verbatim>

## Task
<bead description — verbatim>

## What was implemented
<SUMMARY from the coder/fixer's REPORT block>

## Files changed
<FILES_CHANGED from the coder/fixer's REPORT block>

## Progress log
Write progress to: `.ralph-<bead-id>.log`
Log stage start, security scan result, review outcome, and stage complete (see Progress Logging in run-beads skill).

## Instructions
**First**, invoke the `review-security` skill and run the scan against the changes. If the
verdict is FAIL, set `REVIEW_OUTCOME: CHANGES_REQUESTED` immediately and list each finding
as a required change — do not proceed with the quality review.

**Then**, review the implementation for correctness, quality, and alignment with the task
description and project conventions. Only flag genuine correctness issues or clear deviations
from stated requirements — not stylistic preferences.

End your response with a ---REPORT--- block:
---REPORT---
BEAD_ID: <id>
STAGE_COMPLETED: reviewing
SUMMARY: <2–3 sentence summary of what you reviewed>
FILES_CHANGED: none
REVIEW_OUTCOME: <APPROVED|CHANGES_REQUESTED>
CHANGES_REQUESTED:       ← include only if REVIEW_OUTCOME is CHANGES_REQUESTED
1. <required change>
2. <required change>
---
```

## Fixing Prompt

```
## Project context
<bd prime output — verbatim>

## Task
<bead description — verbatim>

## Required changes (revision <N>)
<CHANGES_REQUESTED list from the reviewer's REPORT block>

## Files to update
<FILES_CHANGED from the previous coder/fixer's REPORT>

## Progress log
Write progress to: `.ralph-<bead-id>.log`
Log stage start, test results, build errors, and stage complete (see Progress Logging in run-beads skill).

## Instructions
Apply only the changes listed above. Do not make any other modifications.

End your response with a ---REPORT--- block:
---REPORT---
BEAD_ID: <id>
STAGE_COMPLETED: fixing
SUMMARY: <2–3 sentence summary of what was changed>
FILES_CHANGED: <comma-separated list, or "none">
---
```

## Documenting Prompt

```
## Project context
<bd prime output — verbatim>

## Task completed
<bead description — verbatim>

## What was implemented
<SUMMARY from the final coder/fixer REPORT>

## Files changed
<FILES_CHANGED from the final coder/fixer REPORT>

## Progress log
Write progress to: `.ralph-<bead-id>.log`
Log stage start and stage complete (see Progress Logging in run-beads skill).

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

End your response with a ---REPORT--- block:
---REPORT---
BEAD_ID: <id>
STAGE_COMPLETED: documenting
SUMMARY: <2–3 sentence summary of what was documented, or "No documentation changes required">
FILES_CHANGED: <comma-separated list of docs touched, or "none">
---
```
