---
"@jaybeeuu/agent-cortex": minor
---

Each agent's tool set is now authored once, in `agents/<name>/tools.json`, and rendered into both
harnesses from `token-map.json`'s capability table. `tools` leaves `frontmatter.json`, which keeps
only harness metadata (`name`, `description`, `model`, `argumentHint`); the validator and the
composer reject a `tools` key there and name the file that holds it. `tools.json` also records the
skill directories the agent loads, which is the mapping nothing had before.

This fixes the bug the change started from: ralph's pi list named none of the peer tools its own
runbook instructs it to call, so the agent reported them as unavailable, and that reads like a
transport fault rather than a missing entry. Ralph now grants `peer_send`, `peer_list`, `peer_get`
and `peer_await` on pi and `SendMessage`/`ListAgents` on Claude Code; `plan` gains the two peer
capabilities its own skill names, and `ralph-plan` gains the subagent tool its text relies on.
`peer_get`, `peer_await`, `task_list`, `task_get` and `task_stop` join the capability table — the
last three keep the claude worker-tracking tools the one-for-two list would otherwise have dropped.

`test/agent-tool-coverage.test.mjs` stages both installs and fails when an agent's text names a
`tool` capability its authored set does not grant, naming the agent and the capability. A `command`
is never demanded and still fails a render, a `null` mapping is not demanded, and a mixed-kind row
(one harness's tool, the other's command) is prose-only because no shared list can grant it. A
`null` row in a tool set is now omitted silently on both sides: one set serves two harnesses, so
the omission is the normal case, not warning noise.
