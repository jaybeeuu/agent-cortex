---
"@jaybeeuu/agent-cortex": patch
---

Prove an epic-landed worktree against the branch it landed on, and name that ref in
the pruner's report. `prune-worktrees.mjs` tested a closed bead's content against
`origin/HEAD` alone, so a task cut from `epic/<epic-id>` was refused while its epic
stayed open: that content never reaches the default branch. The housekeeping
playbook now fetches first, reads the bead graph — the feature bead's
`epic:<epic-id>` label and the epic's count of `feature` children from
`bd children --json` — and passes `--base origin/epic/<epic-id>` for a feature of a
multi-feature epic. The base is the remote-tracking branch, never the local
`epic/<epic-id>`: ralph creates that local branch once and never fast-forwards it,
while a feature PR squash-merges into the remote epic branch. The report's second
line is `Base: <ref>`, so a refusal names the ref that decided it, and the default
base now prints as `origin/HEAD`. An open bead keeps its upstream refusal, and
`--remove-orphans` is unchanged.
