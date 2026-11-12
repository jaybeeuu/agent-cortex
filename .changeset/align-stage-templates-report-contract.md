---
"@jaybeeuu/agent-cortex": patch
---

Align the code, verify, document, and fix REPORT templates on the authoritative
`run-pipeline-stage` contract. Each template now emits `STAGE_COMPLETED` with its stage name
(`code`, `verify`, `document`, `fix`) plus `COMMIT`, `PUSHED`, `PR`, and
`OUTCOME: SUCCESS|BLOCKED`, and lists blocked work under `BLOCKING_ISSUES`. The unparsed
`VERIFY_OUTCOME`/`VERIFY_FAILURES` keys are gone, so an orchestrator can route every stage's
report.
