---
"@jaybeeuu/agent-cortex": patch
---

create-task, prd-to-tasks and plan now express the feature → planning → implementation hierarchy: a feature or epic is `execution:hitl`, its planning bead blocks one `execution:afk` implementation child per deliverable, and the PR gate carries `execution:hitl`. Aggregate execution labels are no longer copied from children onto parents.
