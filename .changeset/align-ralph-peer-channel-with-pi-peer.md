---
"@jaybeeuu/agent-cortex": minor
---

Align ralph's peer-channel text with the installed `@cryptolibertus/pi-peer`, so a report stops
gating dispatch and every message kind travels with the transport's own intent.

The kind-to-intent mapping now has one home, the harness-labelled `### Transport` subsection:
`handoff` travels as `task`, `update`/`done`/`blocked`/`failed` as `notify`, and `get`/`ask` as
`ask`. The shared `### Message kinds` table states no intent, so the two harness renders stay
byte-identical outside that subsection.

On PI, the runbook now names the transport's own default: `peer_send` holds the session open until
the receiver answers unless `await: false` is passed, so the four report kinds are sent with
`await: false` and the returned `messageId` is kept as the handle for `peer_get`.

The text no longer quotes peer-list output the package never prints (`<N> online - <id>`), and
ralph's initialize step takes the planner's peer id from what the list reports instead of assuming
a peer named `planner` exists in every configuration.
