---
"@jaybeeuu/agent-cortex": patch
---

Add a `housekeeping` pipeline stage that runs after the human merge gate. `create-chores.mjs` now
creates a `stage:housekeeping` chore labelled `lifecycle:housekeeping` and blocked behind the
`lifecycle:feature-pr` gate bead, so it stays out of `bd ready` until a human merges the PR and
closes the gate. A dispatched worker then runs `prune-worktrees.mjs` from the main checkout, retries
once on a non-zero exit, and fails the chore without closing it when a closed-bead worktree is still
refused. The four existing stages and the gate are unchanged.
