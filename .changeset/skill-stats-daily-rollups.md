---
"@jaybeeuu/agent-cortex": minor
---

Add long-range retention to the `skill-stats` extension: keep low-fidelity data for a long time and
high-fidelity data for a short time. Usage is now also recorded into a per-day, per-skill rollup
(loaded / invoked / read counts plus the distinct projects seen that day) in
`~/.pi/agent-cortex/skill-usage-daily.json`, pruned to a 365-day window on every write and overridable
with `AGENT_CORTEX_SKILL_STATS_RETENTION_DAYS`. `/skill-stats timeline` renders per-day, per-week and
per-month counts and distinct skills from the rollups alone — no session-transcript scan. History that
predates the rollups is reported as unavailable rather than zero-filled, and a transcript backfill is
deliberately left out. The existing counters, the 200-event ring, the `/skill-stats` report output and
`/skill-usage-reset`'s confirmation flow are unchanged; the reset now also clears the rollups. Each
record is fixed-size — counts, at most 50 project paths per skill-day, each path truncated to 120
characters — and `saveRollups` enforces a hard 2,920,000-byte ceiling on every write (365 days x 40
skills x 200 bytes per skill-day). A write that would exceed it drops the per-skill-day project lists
first, keeping every count and every day, and drops the oldest days only if the counts alone exceed
the ceiling; `saveRollups` returns what it gave up. The suite fills every cap at once, asserts
22,033,268 raw bytes are written as at most 2,920,000, and asserts a second year of data leaves the
file unchanged.
