---
"@jaybeeuu/agent-cortex": minor
---

Add the `idle-watch` extension. A caller arms `idle_watch` when its queue empties;
the tool starts a bounded, backing-off cadence and returns at once, so the turn
ends and the session stays interactive. Each tick runs one configured check as a
child process with a timeout, reduces its JSON to a digest of ids, and sends one
message carrying only what changed. An unchanged digest sends nothing, a failed
or timed-out tick sends nothing, and the cadence stops at a named bound. The
extension holds no domain vocabulary: what to read and what to say are the check's
business.
