---
"@jaybeeuu/agent-cortex": patch
---

`ralph-plan` now creates its planning gate in the Q5 shape the rest of the package implements: the
planning bead is owned by the feature (`--parent <feature-id>`, `execution:hitl`,
`--no-inherit-labels`) and every implementation child depends on it, instead of the owning feature
depending on a parentless gate. The step also records that a planning bead is not a PR gate —
`create-chores.mjs` keeps exclusive ownership of `lifecycle:feature-pr` — and that a standalone task
bead needs no planning bead, and it now scopes its hand-built gate block to a feature that has no
`Plan:` child yet, so it cannot be run beside the gate `create-task` already created. `agents/plan`
gates its `bd dolt push` on the exit status, and `agents/ralph` names the PR gate's owner precisely.
