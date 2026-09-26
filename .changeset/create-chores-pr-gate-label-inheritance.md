---
"@jaybeeuu/agent-cortex": patch
---

Fix the PR gate bead created by `create-task`'s `create-chores.ts` carrying two conflicting
`implementation-type` labels. The gate declares `implementation-type:hitl` explicitly, but
`bd create --parent` also inherited the parent's `implementation-type:afk`, leaving the one
bead whose job is to stop automated merges labelled as autonomous work. The gate now passes
`--no-inherit-labels`; stage chores keep inheriting `:afk` intentionally. A regression test
drives the script against a stateful fake `bd` and asserts the gate's label set exactly.
