---
"@jaybeeuu/agent-cortex": minor
---

Fork the planner ↔ ralph peer channel per harness instead of describing it as PI-only. The channel
now renders through `token-map.json`: `{{TOOL:peer_send}}` and `{{TOOL:peer_list}}` become
`peer_send` and `peer_list` in a pi install, and Claude Code's built-in `SendMessage` and
`ListAgents` in a claude install. Both harnesses carry the same seven message kinds and the same
acknowledgement rule — the kinds table and the reply rule are byte-identical between the two
renders, and only the `### Transport` subsection differs.

Claude Code's cross-session messaging is built in from v2.1.224 (v2.1.234 on native Windows):
`ListAgents` returns the peers a session can reach with the address of each, and `SendMessage`
delivers to that address, so a named peer session is addressable and no manual-handoff-only fork is
needed. `pi-peer`'s `peer_get` and `peer_await` have no Claude Code counterpart, so they are named
only inside the harness-labelled `pi-peer` runbook: a null mapping would drop the token and leave
the sentence that named it broken.

`test/skill-transport-render.test.mjs` stages both installs and asserts the per-harness rendered
text, so a harness that loses its mechanism fails the suite rather than silently degrading.
