---
"@jaybeeuu/agent-cortex": minor
---

Treat a challenged priority as a strategy review, never a silent reorder. `prioritise-work` gains
`CHALLENGE.md` — the sequence from "this should be higher" to a changed rubric — and a second
script, `challenge.mjs record`, which refuses the tempting shortcut: an order that moved while the
strategy version stayed put exits 1 and writes nothing. It reads the strategy through the same
validator, diffs the ranked ids by position so the movement is deterministic, and prints one
bead-trail entry in `run-pipeline-stage`'s trail shape, carrying the words that raised the
challenge and the reasoning that answered it — including when the answer is "no change to the
rubric", which is a valid outcome that must still leave a trace. `--out <path>` writes that entry
to a file, so the documented append is `bd note <bead> --file <path>`: the entry repeats the human's
own words, and a shell string would parse them. `strategy.mjs bump` now requires
`--reason` and appends `- <date> v<n>: <reason>` to the strategy file's new `## Change log`
section, and `validate` fails when the newest entry names a version the header does not, so a
version cannot move without a recorded reason.
