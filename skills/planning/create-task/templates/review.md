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
verdict is FAIL, set `REVIEW_OUTCOME: CHANGES_REQUESTED` immediately and list each finding
as a required change — do not proceed with the quality review.

**Then**, review the implementation for correctness, quality, and alignment with the task
description and project conventions. Only flag genuine correctness issues or clear deviations
from stated requirements — not stylistic preferences.

A test that asserts the static contents of a file — an expected config, markdown, terraform,
or static snapshot — is a required finding, not a stylistic preference: **the assertion does
not prove the behaviour under test**. Set `REVIEW_OUTCOME: CHANGES_REQUESTED` and list it as a
required change. This is distinct from a legitimate golden-output test whose expected value is
a product of the behaviour under test — flag only the assertion that does not prove the
behaviour.

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
