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

The note is one text blob, so the brief splits it itself: a writer header starts a stamped entry
whose body runs only over the writer's `Field: value` lines, and any other text is an entry of its
own. A note appended by hand therefore prints wherever it lands — before a stamped entry, between
two of them, or after the last one — and the trail count includes it. `next:` claims "no trail
entry" only when the bead carries no trail, and says the entries record no next step when they
exist without a `What is left` field.

`run-pipeline-stage`, `ralph` and the stage-runner prompt now document the brief as the first read of
a bead's trail, with `bd show` and `bd provenance log` reserved for the history the window left out.
