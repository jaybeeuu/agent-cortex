---
"@jaybeeuu/agent-cortex": patch
---

Make pipeline-stage workers prove they delivered, and stop dispatch from being
improvised.

A stage worker's `---REPORT---` was taken at face value: nothing instructed it to
commit or push, and nothing checked the worktree afterwards. A worker could
report `OUTCOME: SUCCESS` and leave its changes uncommitted, and ralph would
advance the parent and open the feature PR from a branch holding none of the
work. Six runs needed a human to finish the tree by hand.

- The stage contract now requires delivery: the stage-runner prompt and the
  code, fix, and document playbooks commit and push before reporting, and the
  REPORT gained `COMMIT`, `PUSHED`, and `PR` fields.
- `scripts/lib/verify-worker-tree.mjs` checks the worktree itself — clean tree,
  at least one commit ahead of the recorded base — so ralph gates each stage on
  evidence rather than on the worker's prose.
- ralph stops and reports a missing subagent tool instead of backgrounding
  `pi -p … &`. That substitution has no completion signal, so a finished worker
  and a killed one look identical — the trap that produced the buffered-log and
  post-exit liveness misreadings.
- `token-map.json` records that pi's `task`/`read_agent`/`wait_for_agents` come
  from this repo's `extensions/subagent`, not from pi.
