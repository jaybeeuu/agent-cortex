---
"@jaybeeuu/agent-cortex": patch
---

Add the `agent-guardrails` pi extension: it appends behavioural circuit-breakers to the PI
system prompt on every turn — two-strikes retry limits, explicit check-in triggers, and
atomic-change discipline (first slice of `docs/ideas/improve-pi-system-prompt.md`).
