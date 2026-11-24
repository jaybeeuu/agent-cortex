---
"@jaybeeuu/agent-cortex": patch
---

Record the worktree preference: the primary checkout stays on `main`, every branch lives in its own
worktree under `.agent-cortex/worktrees/<slug>`, and the worktree is removed once the pull request
merges.
