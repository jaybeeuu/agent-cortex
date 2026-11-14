---
"@jaybeeuu/agent-cortex": minor
---

Add the `prioritise-work` skill, the `strategy.md` template it copies, and the `strategy.mjs` script
that validates and versions it. The strategy is a committed file in the consuming repository's
working-docs root (`.agent-cortex/working-docs/strategy.md`, overridable with `--file`), never a bead
and never a scratch note — the skill performs no tracker writes at all. `init` writes the template
stamped with the creation date and refuses to overwrite; `validate` checks a positive-integer version,
a `YYYY-MM-DD` date, and five required sections — themes, value, confidence, out-of-scope and effort
calibration — naming each missing, empty or malformed one, and prints the rubric to stdout only when
the file passes, so a scorer can never read a stale or malformed rubric; `bump` refuses an invalid
file, raises the version by one and records today's date. The five interview questions map one-to-one
onto the five sections, and `using-agent-skills` routes ranking questions to the new skill.
