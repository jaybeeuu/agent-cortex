---
"@jaybeeuu/agent-cortex": minor
---

Add the `post-merge` pipeline stage and the deterministic check it runs.
`skills/workflow/ralph/scripts/post-merge-check.mjs` reads `gh run list` for the base branch's merge
commit and exits `0` passed, `1` failed, `2` inconclusive — no model, no tokens, zero runtime
dependencies, async only. A failing run files exactly one P1 escalation bead carrying the run URL
and the failing job name; the `post-merge-run:<id>` marker in its description makes a second run
file nothing. It never retries, never re-runs the workflow, never reopens the parent, and is
GitHub-only in v1 (a repository `gh` cannot resolve to a GitHub host, or a commit with no run, is
inconclusive and files nothing). `create-chores.mjs` pre-creates the chore labelled
`lifecycle:post-merge`, blocked behind the `lifecycle:feature-pr` gate rather than behind a stage,
so it becomes ready only once a human merges and closes the gate; a re-run still creates nothing.
The script reads the repository slug and base branch from `gh repo view`, so no slug or branch is
baked in. `housekeeping` and `post-merge` are siblings on the gate and neither waits on the other,
because an inconclusive check must not strand the worktree reclamation.
