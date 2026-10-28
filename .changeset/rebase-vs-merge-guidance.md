---
"@jaybeeuu/agent-cortex": patch
---

The `git-workflow` skill now says how to bring a behind branch up to date, and
why the answer is usually "merge the base in" rather than "rebase". `git rebase`
drops merge commits and the patches they carry, so rebasing a branch that has
already merged the base silently reverts what that merge resolved — the conflict
resolutions, and any fix from the base the merge brought in — and the result
reads like a regression in the branch's own change. `--rebase-merges` keeps the
structure but re-opens the same conflicts, so it earns its cost only when the
branch history is the deliverable. Rebasing stays right for a linear branch that
has not been reviewed yet, and then it needs `--force-with-lease`.

The choice follows from the repository's landing method, not from taste: a squash
merge collapses the branch, so its shape never reaches the base branch, while a
rebase-and-merge requires linear history and therefore a rebase before the first
review rather than after a merge. `AGENTS.md` now records this repository's
answer — squash merge, merge commits disabled, `main` requires linear history —
because that is a fact about this checkout, not portable practice.
