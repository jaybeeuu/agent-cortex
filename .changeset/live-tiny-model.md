---
"@jaybeeuu/agent-cortex": patch
---

Point the shipped pi settings at models that still exist. `tinyModel.model` was
`opencode/mimo-v2.5-free`, which the provider catalogue has dropped, so the
setting resolved to nothing and pi fell back to another free model. That fallback
returns `429 FreeUsageLimitError` once the free quota is spent, and the 429 JSON
became the entire output of the background call that runs auto-naming and
notifications — so a subagent run died at session start while the agent itself was
on a paid model. `tinyModel.model` is now `opencode-go/deepseek-v4.1-flash`.
`enabledModels` also drops three ids that do not resolve — `opencode-go/deepseek-v4-flash`,
`opencode/deepseek-v4-flash` and `opencode/mimo-v2.5-free` — which made pi print a
`No models match pattern` warning on every startup.
