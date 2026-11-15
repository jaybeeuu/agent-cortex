---
"@jaybeeuu/agent-cortex": patch
---

Remove a landed closed bead's worktree when the merge deleted its remote branch.
`prune-worktrees.mjs` refused every such worktree with "has no remote-tracking
branch", because a merge that deletes the branch also removes the local branch's
upstream — so the one case the script exists to handle failed housekeeping. A
missing upstream is now distinguished by content: with the tree clean and the
base branch already holding everything in the branch, the worktree and its local
branch are removed; otherwise the worktree is kept and the refusal names the
risk. The base is the remote's default branch, read from `origin/HEAD` and never
hardcoded, with `--base <ref>` as the documented override; an unresolvable base
keeps the worktree and refuses.
