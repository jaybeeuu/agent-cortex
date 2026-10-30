---
"@jaybeeuu/agent-cortex": patch
---

Gate every `bd dolt push` in the `ralph` and `plan` skills on its exit status. Both skills ran
the push as a completion step and proceeded straight to the Pending Human Action / completion
summaries, so a failed sync — an unconfigured or corrupt Dolt remote exits non-zero — looked like
a clean shutdown while bead state never reached the remote.

Every push site now carries the same gate: on a non-zero exit, retry once, then stop and report
the command, exit code and stderr as a sync blocker instead of printing any completion summary.
The gate is stated once per path — the ralph skill's _HITL pause and shutdown_ section and its
verification checklist, the ralph REFERENCE _HITL Pause_ and _Shutdown_ steps, the ralph agent
body's equivalents, and the plan skill's push step and its Phase 4 and verification checklists —
and the checklists now require the push to have exited 0 rather than merely to have run.
