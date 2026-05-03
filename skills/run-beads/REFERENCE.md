# Per-Stage Prompt Templates

All prompts must include the `bd prime` output verbatim. Tailor the rest per stage.

## Test-Writing Prompt

```
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
```

## Test-Reviewing Prompt

```
## Project context
<bd prime output — verbatim>

## Task
<bd show <id> output — verbatim>

## Test files
<list of test files with their full content>

## Progress log
Write progress to: `.ralph-<bead-id>.log`
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
```

## Coding Prompt

```
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
Write progress to: `.ralph-<bead-id>.log`
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
```

## Verifying Prompt

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
Log stage start, each command run, test/lint result, and stage complete (see Progress Logging in run-beads skill).

## Instructions
Discover and run the project's test and lint commands, then report the outcome.

**Step 1 — Discover commands** (check in this order, stop at the first match):
1. `package.json` `scripts` — look for keys named `test`, `lint`, `check`, `typecheck`, or similar.
2. `Makefile` — look for targets named `test`, `lint`, `check`.
3. Other well-known config files (e.g. `pyproject.toml`, `Cargo.toml`) — look for test/lint targets.
4. If no commands are found, report PASS with summary "No test or lint commands found".

**Step 2 — Run each discovered command** in the project root. Capture stdout and stderr.

**Step 3 — Evaluate**:
- If all commands exit 0: `VERIFY_OUTCOME: PASS`.
- If any command exits non-zero: `VERIFY_OUTCOME: FAIL`. List each failure concisely.

Do not fix failures — report them only.

End your response with a ---REPORT--- block:
---REPORT---
BEAD_ID: <id>
STAGE_COMPLETED: verifying
SUMMARY: <what commands were run and overall outcome>
FILES_CHANGED: none
VERIFY_OUTCOME: <PASS|FAIL>
VERIFY_FAILURES:          ← only if VERIFY_OUTCOME is FAIL
- <test/lint failure summary>
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

After applying all fixes, hand off to the **test-reviewing** stage.

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
