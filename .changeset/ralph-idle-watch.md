---
"@jaybeeuu/agent-cortex": minor
---

ralph arms an idle watch when its queue empties. The mechanism already
shipped — the `idle-watch` extension on pi and `ScheduleWakeup` on claude — but
nothing told ralph to use it, so ready work waited for a human to speak. The
policy now ships as text: ralph arms the watch only when `bd ready -l
execution:afk` is empty and no worker is in flight, runs the idle check once on
a wake and acts on the ids it printed, inspects a stalled bead before
re-dispatching it, re-arms after acting (which also refills the budget), and
reports watching, last check and nudges beside the bead view. Both idle endings
— HITL Pause and Shutdown — arm it, so a bead that becomes ready while ralph is
idle resumes it instead of waiting for a prompt.

The mechanism is forked at install time through the new `idle_watch` token row
and appears in ralph's per-harness tool allowlist. Everything around it is one
authored copy that describes only what both mechanisms do, and a session with
neither runs the check once and waits for the prompt rather than faking a
cadence.
