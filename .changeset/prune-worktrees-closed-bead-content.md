---
"@jaybeeuu/agent-cortex": patch
---

Let the content proof decide a closed bead's worktree, whatever its upstream is.
`prune-worktrees.mjs` still refused every worktree ralph created, because ralph
cuts its branch from the remote base (`git worktree add -b feature/<id> …
origin/main`), `branch.autoSetupMerge` makes that base the branch's upstream, and
the squash merge that lands the work rewrites its commits — so the branch stays
ahead of its own base for ever and the unpushed-commit check, which ran first,
always fired. A closed bead is now decided by content alone: the base must hold
the branch's own version of every path the branch changed since their merge base,
and the refusal names that content when it does not. An open bead keeps the
upstream refusal, and with no upstream it is refused whatever the content says.
The base guard now tests the ref instead of the tip: a base that names the
worktree's own branch (local or remote-tracking) is a self-comparison and
refuses, while a branch cut from the base and never committed to holds the base's
own commit and is removed — the case every fresh ralph worktree used to reach.
