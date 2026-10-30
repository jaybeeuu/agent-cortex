---
"@jaybeeuu/agent-cortex": patch
---

Ban stacked branches, and make a stacked PR fail CI.

`git-workflow` gains rule 3: every branch is based on the integration branch (`main`, or
`epic/<id>` for multi-feature work), never on another `feature/*`. A dependency between two tasks
belongs in the bead graph — `bd dep add <waiting> <blocked-on>` keeps the dependent task out of
`bd ready` until its dependency merges — not in the branch base. `ralph`'s branching model and its
_Feature Branches and Worktrees_ procedure now say so explicitly, including not creating a worktree
early while a `blocks` dependency is unmerged and not reusing a sibling task's worktree.

A new `No stacked PRs` CI job fails any pull request whose base matches `feature/*`, because the
rule only holds if forgetting it is visible. The job must be added to the main branch ruleset's
required checks to actually block a merge.

The cost of the old behaviour: this repo squash-merges, so a lower branch's commits never become
ancestors of the integration branch. Once it merges, the upper PR carries that whole diff as new
work and reports conflicts on byte-identical files — three occurrences in two days, each repaired
with a manual `rebase --onto` plus a full re-verification.
