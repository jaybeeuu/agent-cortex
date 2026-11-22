---
"@jaybeeuu/agent-cortex": minor
---

Give `guppi` the peer tools on both harnesses, so it can coordinate with `ralph` while it stays out
of execution.

On pi the guppi allowlist gains `peer_list`, `peer_send`, `peer_get`, `peer_await`, `peer_progress`
and `peer_context`. On Claude Code it gains the built-in `SendMessage` and `ListAgents`. The agent
body names no harness tool: it grants coordination in one new first boundary bullet and restates the
one prohibition beside it — guppi never executes `execution:afk` work, never runs a pipeline stage
and never claims an AFK bead.

The PR-feedback interrupt row no longer says guppi sends no peer message. The bead stays the record
`ralph` reads, and a peer message about it is a courtesy beside that record.

`.gitignore` now ignores the local state `pi-peer` creates: `.pi/peers.json` holds the local peer
identity and trust settings, and `.pi/peer-*` holds the per-peer files. It also ignores
`.pi/settings.json`, which `pi-peer` reads and never writes.
