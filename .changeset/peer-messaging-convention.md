---
"@jaybeeuu/agent-cortex": minor
---

Document the planner ↔ ralph message convention on top of `@cryptolibertus/pi-peer`. The `ralph`
skill now publishes its peer identity at start (`PI_PEER_ID=ralph`), answers inbound `handoff`,
`get` and `ask` messages, and reports `update`/`done`/`blocked`/`failed` to the planner as work
dispatches, finishes, parks on a human gate or fails. The `plan` skill sends a `handoff` message
naming the handoff bead once it exists, treats ralph's `blocked` messages as its pending-human
surface, and keeps the manual instruction as the handoff path — the only path in Claude Code, because
this channel is PI-only.

The shared convention — the kind-to-intent table, the acknowledgement rule, the two-entry
`.pi/peers.json` requirement and the one-way discovery failure a single entry causes, the
`.pi/peers.json` and `.pi/peer-*` paths to gitignore, and the rule to send through `peer_send` rather than typing into a
busy session — lives once in `skills/workflow/ralph/REFERENCE.md` and is cross-referenced from
`plan`. pi-peer keeps ownership of discovery, delivery, idle wake and the ledger; no registry,
inbox, watcher or transport is implemented here. `peer_send` and the `/peer` commands stay plain
inline code, not `{{TOOL:...}}` tokens, because the package is PI-only and an unknown tool token is
a hard installer error.
