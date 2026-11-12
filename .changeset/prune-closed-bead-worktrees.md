---
"@jaybeeuu/agent-cortex": patch
---

Add `skills/workflow/ralph/scripts/prune-worktrees.mjs`, the deterministic pass that converges the
ralph worktree set with bead state. It scans `.agent-cortex/worktrees/*`, classifies each directory
by its bead as a closed-bead worktree, an open-bead worktree, or an orphan, and removes a
closed-bead worktree with its local and remote branch. A dirty tree, a locked worktree, or an
unpushed branch refuses that worktree with the reason. Orphans are reported only, and
`--remove-orphans` is the single path that removes one.
