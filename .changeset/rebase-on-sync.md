---
"@jaybeeuu/agent-cortex": minor
---

Sync a behind branch by rebasing it onto `main`, not by merging `main` in. The `git-workflow` skill
previously told agents to merge the base in, which dragged every intervening commit into the review
diff and left a merge commit behind; rule 6 now says fetch, rebase onto `origin/main`, and
force-push with `--force-with-lease`. Rewritten commits are re-signed automatically by
`commit.gpgsign`, so no extra flag is needed, and the rule is scoped to your own unmerged branch —
never `main`, never a branch someone else is working on. Landing is unchanged: squash-merge still
governs how a branch reaches `main`, so the two decisions can no longer be read as one rule.
`AGENTS.md` splits its collapsed "Landing method" bullet into those two decisions accordingly.
