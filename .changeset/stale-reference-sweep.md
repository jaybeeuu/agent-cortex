---
"@jaybeeuu/agent-cortex": patch
---

Sweep the last stale references to the retired bead model. The `plan` agent's Phase 3 summary no
longer tells the planner to tag parent epics with a classification aggregated from their children —
a container epic is `execution:hitl`, and each bead beneath it states its own execution class. The
`agent-guardrails` extension cites its originating idea by name instead of by its retired
`docs/ideas/` file path.
