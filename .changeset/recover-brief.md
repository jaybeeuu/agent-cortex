---
"@jaybeeuu/agent-cortex": minor
---

Read a half-finished bead in one bounded command, without opening the transcript.

`skills/workflow/run-pipeline-stage/scripts/recover-brief.mjs` is the read side of the bead trail
that `trail-entry.mjs` writes. One invocation prints what a session needs to continue: status and
state labels, the newest trail entries with their Evidence and What is left, the provenance refs,
the blocking dependencies, and the acceptance criteria.

The bound is enforced, not promised. `bd show` returns the whole note — no option asks it for the
last few entries — and a bead carrying 20 entries prints 118 lines and about 8 KB. The brief prints
the newest `--trail` entries (default 3), summarises the rest by count, clips any single field, and
holds its whole output to a line budget (default 40) even when the requested window is wider than
that: it shrinks the window, names what it left out, and never prints more lines than `--max-lines`.

It reads only. Every `bd` call is one of the read subcommands and carries `--readonly`, and a call
that is not on the allow-list is refused before it reaches the binary, so the brief cannot write a
note, a status or a provenance event. Each section states plainly when a bead has no trail, no
refs, no acceptance criteria or no blockers, instead of printing an empty heading.

`run-pipeline-stage`, `ralph` and the stage-runner prompt now document the brief as the first read of
a bead's trail, with `bd show` and `bd provenance log` reserved for the history the window left out.
