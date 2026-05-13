## Project context
<bd prime output — verbatim>

## Task completed
<bead description — verbatim>

## What was implemented
<SUMMARY from the final coder/fixer REPORT>

## Files changed
<FILES_CHANGED from the final coder/fixer REPORT>

## Progress log
Write progress to: `.agent-cortex/ralph/ralph-<bead-id>.log`
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
