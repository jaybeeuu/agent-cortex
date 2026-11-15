---
"@jaybeeuu/agent-cortex": minor
---

Add the `hitl-queue` skill: one command ranks the open `execution:hitl` beads by RICE ×
(1 + ln(1 + transitively blocked dependents)) × 1.5 when in progress, printing every row's
components, multipliers and what each answer unblocks. The `plan` skill, the `plan` agent and the
`ralph-plan` agent report that queue before dispatching or proposing anything.
