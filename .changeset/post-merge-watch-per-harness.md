---
"@jaybeeuu/agent-cortex": minor
---

Fork the post-merge stage's watch per harness instead of leaving a long run unwatched. The stage
playbook now carries a `## Watch transport` section whose single mechanism name renders through
`token-map.json`: `{{TOOL:post_merge_watch}}` becomes `post-merge-watch` — this package's own
extension, which re-runs the check on a timer and wakes an idle session with the verdict — in a pi
install, and Claude Code's built-in `ScheduleWakeup` tool in a claude install. The stage
instructions, the three verdicts, the never-retry rule, the escalation rule and the close rule stay
one authored copy: the two renders differ on exactly one line.

The Claude capability is established from the installed binary (2.1.294), not assumed.
`ScheduleWakeup` is a registered tool whose own description names the case in point — "when actively
polling external state the harness can't notify you about (a CI run, a deploy, a remote queue), pick
the delay from how fast that state actually changes" — it takes `delaySeconds` clamped to
60–3600, `prompt`, `reason`, `noop` and `stop`, and a built-in system reminder says "If polling in a
loop, use ScheduleWakeup instead of retrying". A live probe was impossible: `claude -p` in this
environment reports "Not logged in · Please run /login". Because availability is a property of the
session rather than of the tool's existence, the section also states the fallback in prose — one run
with `--wait 1800` — so no harness is assumed to have a watcher and neither render loses a name.

`test/post-merge-transport-render.test.mjs` stages both installs and asserts the per-harness rendered
playbook, the byte-identical remainder, and the no-watcher fallback, so a harness that loses its
mechanism fails the suite rather than silently degrading.
