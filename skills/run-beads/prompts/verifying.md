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
