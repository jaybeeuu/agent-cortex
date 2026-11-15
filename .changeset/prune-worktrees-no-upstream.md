---
"@jaybeeuu/agent-cortex": patch
---

Remove a landed closed bead's worktree when the merge deleted its remote branch.
`prune-worktrees.mjs` refused every such worktree with "has no remote-tracking
branch", because a merge that deletes the branch also removes the local branch's
upstream — so the one case the script exists to handle failed housekeeping. A
missing upstream is now distinguished by content: with the tree clean and the
base branch holding the branch's own version of every path the branch changed
since their merge base, the worktree and its local branch are removed; otherwise
the worktree is kept and the refusal names the risk. The test is one-sided, so a
base that moved on after the branch was cut still proves the branch landed. It
proves content and never history: a removed branch is discarded with every
commit the base does not contain, such as a reverted change or an empty commit.
The base is the remote's default branch, read from `origin/HEAD` and never
hardcoded, with `--base <ref>` as the documented override; an unresolvable base
keeps the worktree and refuses. A base that resolves to the worktree's own
commit also keeps the worktree and refuses, because comparing a branch with
itself proves nothing.

The content proof also survives a path git would otherwise rewrite. The branch's
changed paths are read with `git diff --name-only -z` and split on NUL, then fed
back under `git --literal-pathspecs`, so a path holding a non-ASCII byte, a double
quote, a backslash, a leading colon or a newline round-trips exactly. Without both,
such a path matched no pathspec, the second diff came back empty, and a branch the
base never received was removed with an empty reason list.
