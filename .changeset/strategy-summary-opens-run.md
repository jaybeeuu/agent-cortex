---
"@jaybeeuu/agent-cortex": minor
---

Open a `prioritise-work` run with a summary of the committed strategy instead of a question. A new
`strategy.mjs summary` subcommand validates the file first, then prints a handful of lines — the
path it read, the version, the newest change-log entry, the themes, the two admissibility lists as
up to two bullets each, and the deadline factors when the file states them — so the digest cannot
describe a strategy that is not on disk. The skill shows it and asks "what should change?" before
the interview; with no strategy file it exits `3` and the skill goes straight to the first-run
interview with no digest; with an invalid or partly missing one it exits `1` and names what is wrong
rather than presenting it as current. The change requires no new section of the strategy file, so
every strategy already committed still validates: `## What counts as value` and `## Explicitly out
of scope` are summarised as the admissibility lists they are, never as a ranking order, and
`## Deadline tiers` is summarised narrowest first, the order the queue applies the factors, whatever
order the file holds the rows in.

The script contract moved to the skill's `REFERENCE.md` so `SKILL.md` stays within its length target.
