---
"@jaybeeuu/agent-cortex": patch
---

Teach `prune-worktrees.mjs` that a superseded path and a released changeset still prove landed work.
A closed-bead worktree was refused for ever in two ordinary cases: the branch's path landed in its
squash commit and a later pull request rewrote it, or the branch added a changeset the release commit
consumed into `CHANGELOG.md`. The content test now accepts a path when the base's tip holds the
branch's version, when a commit on the base holds the branch's blob at that same path after the merge
base, or when a commit on the base deleted a `.changeset/*.md` and recorded its text elsewhere. Each
proof names its commit in the report (`proven: superseded at <sha>`, `proven: changeset released in
<sha>`). A blob on its own proves nothing: the empty blob, and any two files holding the same bytes,
are one object, so a match counts only where the base holds it at the path under test. Every existing
refusal is unchanged: a dirty worktree, a branch with no upstream, and content the base never held are
still refused.
