---
"@jaybeeuu/agent-cortex": minor
---

Open a `prioritise-work` run with a summary of the committed strategy instead of a question. A new
`strategy.mjs summary` subcommand validates the file first, then prints a handful of lines — the
path it read, the version, the newest change-log entry, the themes, and the precedence rules as up
to two bullets per section — so the digest cannot describe a strategy that is not on disk. The skill
shows it and asks "what should change?" before the interview; with no strategy file it exits `3` and
the skill goes straight to the first-run interview with no digest; with an invalid or partly missing
one it exits `1` and names what is wrong rather than presenting it as current. No section is
required of the strategy file, so every strategy already committed still validates: the precedence
rules are read from `## Current themes`, `## What counts as value` and `## Explicitly out of scope`.
The script contract moved to the skill's `REFERENCE.md` so `SKILL.md` stays within its length target.
