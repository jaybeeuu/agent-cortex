---
"@jaybeeuu/agent-cortex": patch
---

Add background watch policy to ralph's agent definition. The always-active idle watch monitors the bead queue and nudges the session when work needs attention, separate from the subagent wake mechanism. Documents watch behavior (cadence, self-healing, notification rules), lifecycle (start, re-arm, stop), and harness-specific implementation for both PI and Claude.
