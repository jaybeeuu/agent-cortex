---
"@jaybeeuu/agent-cortex": patch
---

Add `agent-cortex migrate`, a repo-agnostic, versioned migration command for beads
workspaces. It detects the workspace's current migration version from its own state, prints
a per-bead dry-run plan by default, and `--apply` renames `implementation-type:afk|hitl`
labels to `execution:afk|hitl` (step v1) across every bead including closed ones, verifying
each step and no-opping on a re-run.
