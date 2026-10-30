---
"@jaybeeuu/agent-cortex": patch
---

Move leaf execution bead ownership to the stage worker. The stage runner now appends its
own milestone notes, closes its own bead on both outcomes, and builds its own remediation
chain (a `stage:fix` chore plus a fresh instance of the failed stage, blocked in order) with
a `maxFixRounds` check before it does. `run-pipeline-stage` documents that contract across its
prompt, playbooks, and skill, and ralph no longer closes leaf beads or creates feedback
beads — it keeps a read-only cap backstop only.
