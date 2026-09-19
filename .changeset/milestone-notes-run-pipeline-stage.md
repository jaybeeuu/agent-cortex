---
"@jaybeeuu/agent-cortex": patch
---

Add a milestone-notes discipline to the `run-pipeline-stage` skill: the stage-runner prompt and
SKILL.md now instruct agents to append a short checkpoint to the bead's notes (`bd update <id>
--append-notes`) at stage start and at each milestone, so a fresh session can resume from
`bd show <id>` alone if the original session dies mid-stage.
