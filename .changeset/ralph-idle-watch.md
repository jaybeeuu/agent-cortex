---
"@jaybeeuu/agent-cortex": minor
---

ralph runs an idle watch for its whole session. The mechanism already shipped —
the `idle-watch` extension on pi and `ScheduleWakeup` on claude — but nothing
told ralph to use it, so a stalled worker or ready work waited for a human to
speak. The policy now ships as text: ralph starts the watch at startup, before
the first dispatch, and it runs until ralph closes. On each wake ralph reads
whether the watch is running and arms it again if it is not, runs the idle check
once, acts on the ids it printed, inspects a stalled bead before re-dispatching
it, and reports watching, last check, nudges and stalled ids beside the bead
view. A wake is a re-check and never approval, and it never ends the session.

The watch has no tick limit: it is session-scoped, so a re-arm repairs a stopped
mechanism instead of refilling a spent allowance. Both idle endings — HITL Pause
and Shutdown — keep it running and report its status line.

The mechanism is forked at install time through the `idle_watch` token row and
appears in ralph's per-harness tool allowlist. Everything around it is one
authored copy that describes only what both mechanisms do, and a session with
neither runs the check once and waits for the prompt rather than faking a
cadence.
