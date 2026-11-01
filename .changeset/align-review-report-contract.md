---
"@jaybeeuu/agent-cortex": patch
---

Align the review REPORT contract on the run-pipeline-stage playbook shape: the review template
and the `review-security` skill now emit `OUTCOME: SUCCESS|BLOCKED` with `BLOCKING_ISSUES`,
instead of the unparsed `REVIEW_OUTCOME`/`CHANGES_REQUESTED` keys.
