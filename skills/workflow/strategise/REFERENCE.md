# The strategy scripts

The contract behind [SKILL.md](SKILL.md): what each subcommand prints, and the exit codes the
skill routes on. The workflow lives in `SKILL.md`; this file is the reference for one run.

Two scripts, five subcommands, zero dependencies, no tracker access. `strategy.mjs` reads and
writes the strategy file; `challenge.mjs` reads it and prints a trail entry. No run creates, tags
or closes a bead.

| Command | Behaviour | Exit |
|---|---|---|
| `init` | Writes the template, stamped with today's date; refuses an existing file | 0 written, 1 refused |
| `validate` | Checks the version integer, the date, the change log, the deadline tiers, the four level tables and every required section; prints the file to stdout when valid | 0 valid, 1 invalid |
| `bump` | Refuses an invalid file or an empty `--reason`, raises the version by one, records today, appends the change-log line | 0 bumped, 1 invalid file, 2 no or empty `--reason` |
| `summary` | Validates first, then prints the digest a run opens with: the path it read, the version, the newest change-log entry, the themes and the two admissibility lists as up to two bullets each, and the deadline factors and each level table when the file states them | 0 summarised, 1 invalid, 3 no file |
| `record` (`challenge.mjs`) | Refuses an order or a resolution the strategy does not support; prints one bead-trail entry | 0 recorded, 1 refused |

`summary` is the one command that separates "absent" from "wrong". It exits `3` only when the file
is not there, because the skill's next move is the first-run interview and no digest; a file that is
present but fails the shape check exits `1` with the validator's own lines, never a digest. Both
paths print nothing to stdout, so a caller can show whatever arrives there without deciding what to
hide.

`validate` splits its output: status and errors go to stderr, the rubric goes to stdout.
`validate > rubric.md` captures the rubric alone, which is how a scorer loads it. A failing run names
the file and lists one line per defect, so one fix round clears the whole file.

The date is checked as a **calendar** date, not as a shape. `2026-02-31` and `2026-04-31` fail in
both `validate` and `--today`, because V8's ISO parser rolls them into the next month and accepts
them; `2024-02-29` passes and `2026-02-29` does not. A rolled date records a change on a day it did
not happen.

Exit code 2 means a malformed call — an unknown subcommand, a bad `--today`, or a missing or empty
`--reason`. `--today YYYY-MM-DD` exists so a test pins the recorded date; a person accepts the default.
