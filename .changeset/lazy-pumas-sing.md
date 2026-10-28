---
"@jaybeeuu/agent-cortex": patch
---

`agent-cortex install pi` no longer registers the git worktree it was invoked from as the pi package source. When the package root is a linked worktree (its `.git` is a file and `git rev-parse --git-common-dir` differs from `--git-dir`), the settings `packages` entry now resolves to the main checkout, with a warning naming the checkout that was registered instead. Previously a run inside `.agent-cortex/worktrees/<id>` left `~/.pi/agent/settings.json` pointing at that gitignored, ephemeral worktree — which dangles as soon as the worktree is removed.
