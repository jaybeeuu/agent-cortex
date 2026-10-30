---
"@jaybeeuu/agent-cortex": patch
---

Make the ralph agent body harness-neutral and rename its `{{SECTION:polling}}` seam to
`{{SECTION:wake}}`. `agents/ralph/agent.md` no longer names a harness (Copilot, PI, Claude) or a
harness-specific tool (`wait_for_agents`, `read_agent`, `Task`): every such fact — the spawn call
and its argument shape, how a completion arrives, the ids tracked (`agentId`, `timerShellId`),
what stopping means, and whether a log must be flushed — now lives in that harness's
`agents/ralph/<harness>/wake.md`. The shared body refers to the wake section instead, so composing
it for one harness can never emit instructions about another harness's tools.

The section name now matches what it does: `wake` covers polling, blocking wait, and event-driven
wake-ups, whereas `polling` was simply wrong for the event-driven harness, where no polling exists.
The mechanism is recorded per harness rather than inferred from prose — `token-map.json` gains a
`wake.mechanism` table (`copilot`: `polling`, `pi`: `blocking-wait`, `claude`: `event-driven`) and
`agents/README.md` documents the same table alongside the ralph layout. `agents/ralph.agent.md` is
regenerated from the composable sources; no Copilot behaviour changes.
