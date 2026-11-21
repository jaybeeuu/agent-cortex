---
"@jaybeeuu/agent-cortex": patch
---

Name the withheld candidates when the HITL queue can rank nothing. When every scored candidate was
withheld by an open blocker and an unscored row remained, `hitl-queue` printed "no RICE score on any
candidate — nothing can be ranked; score one with score-bead, then re-run" — advice that cannot help,
because the scores exist and a blocker holds them. That state now prints "nothing can be ranked —
<n> scored candidate(s) held by an open blocker; clear a blocker or score an unscored row with
score-bead, then re-run". The message for a queue with genuinely no scores is unchanged.
