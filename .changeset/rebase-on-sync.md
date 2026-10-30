---
"@jaybeeuu/agent-cortex": minor
---

Sync a behind branch by rebasing it onto its base branch, not by merging the base in. The
`git-workflow` skill previously told agents to merge the base in, which dragged every intervening
commit into the review diff and left a merge commit behind; rule 6 now says fetch, rebase onto
`origin/main` (or `epic/<id>` for a feature branch inside an epic), and force-push with
`--force-with-lease`. Rewritten commits are re-signed automatically by `commit.gpgsign`, so no
`--gpg-sign` and no `rebase.gpgSign` is needed. The rule is scoped to your own unmerged branch —
never `main`, never a branch someone else is working on — with one stated exception: a shared
integration branch that other branches are based on is synced by merging the base in, because
rewriting it would rewrite history under every branch based on it. Landing is unchanged:
squash-merge still governs how a branch reaches `main`, so the two decisions can no longer be read
as one rule. `AGENTS.md` splits its collapsed "Landing method" bullet into those two decisions
accordingly.
