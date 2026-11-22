---
"@jaybeeuu/agent-cortex": patch
---

Teach `prune-worktrees.mjs` that a superseded path and a released changeset still prove landed work.
A closed-bead worktree was refused for ever in two ordinary cases: the branch's path landed in its
squash commit and a later pull request rewrote it, or the branch added a changeset the release commit
consumed into `CHANGELOG.md`. The content test now accepts a path when the base's tip holds the
branch's version, when the branch's blob appears in the base's history after the merge base, or when
a commit on the base deleted a `.changeset/*.md` and recorded its text elsewhere. Each proof names
its commit in the report (`proven: superseded at <sha>`, `proven: changeset released in <sha>`). Every
existing refusal is unchanged: a dirty worktree, a branch with no upstream, and content the base never
held are still refused.
