## Project context
<bd prime output — verbatim>

## Stage metadata
- Stage: `<stage>`
- Playbook: `skills/run-pipeline-stage/playbooks/<stage>.md`

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
STAGE_COMPLETED: <code|verify|review|document>
SUMMARY: <2–3 sentence summary>
FILES_CHANGED: <comma-separated list, or "none">
OUTCOME: <SUCCESS|BLOCKED>
BLOCKING_ISSUES:                               ← only if OUTCOME is BLOCKED
- <specific blocking issue>
---
