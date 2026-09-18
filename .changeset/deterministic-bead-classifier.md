---
"@jaybeeuu/agent-cortex": patch
---

Add a deterministic classifier to the `classify-bead` skill
(`skills/planning/classify-bead/scripts/classify-bead.mjs`). One command resolves an
existing `implementation-type` label, the legacy `## Type` field, then conservative
heuristic signals, and applies the label itself; only beads with no deterministic signal
escalate to the rubric subagent. `create-task` and `write-a-prd` now run the classifier
before spawning a subagent, and `--audit` reports the deterministic-vs-rubric split
over recent beads.
