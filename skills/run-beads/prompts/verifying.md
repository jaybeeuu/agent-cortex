## Project context
<bd prime output — verbatim>

## Stage metadata
- Stage: `verifying`
- Playbook: `skills/run-beads/playbooks/verifying.md`

## Bead specification
<bd show <id> output — verbatim>

## Prior stage context (if any)
<prior REPORT fields, dependency context, and relevant files>

## Progress log
Write progress to: `.agent-cortex/ralph/ralph-<bead-id>.log`

## Instructions
1. Read and follow the playbook file listed above.
2. Treat the bead as the source-of-truth specification (not a prompt script).
3. Keep output factual and stage-scoped.

End your response with a `---REPORT---` block:
---REPORT---
BEAD_ID: <id>
STAGE_COMPLETED: verifying
SUMMARY: <2–3 sentence summary>
FILES_CHANGED: <comma-separated list, or "none">
TEST_REVIEW_OUTCOME: <DONE|NEEDS_MORE>         ← test-reviewing stage only
GAPS:                                          ← only if TEST_REVIEW_OUTCOME is NEEDS_MORE
- <uncovered requirement>
VERIFY_OUTCOME: <PASS|FAIL>                    ← verifying stage only
VERIFY_FAILURES:                               ← only if VERIFY_OUTCOME is FAIL
- <test/lint failure summary>
REVIEW_OUTCOME: <APPROVED|CHANGES_REQUESTED>   ← reviewing stage only
CHANGES_REQUESTED:                             ← only if REVIEW_OUTCOME is CHANGES_REQUESTED
1. <required change>
---
