---
"@jaybeeuu/agent-cortex": minor
---

`boundary` accepts two outcomes and no third. `--decide` takes `stay` or `switch`, and `--decide
move` is refused with a message naming both, because `move` was the one outcome with no protocol
behind it: no checkpoint, no rewind, no resume. Its two real jobs already live elsewhere — `switch`
with `--reason` when the queue disagrees, and the **interrupt** protocol when something arrives and
you must come back — so the boundary block now asks for `stay` or `switch`, and `BOUNDARY.md`'s
outcome table carries two rows plus a pointer to `## Interrupts` for the leave-and-return case.

The reason requirement is unchanged in force and restated in shape: a decision that contradicts the
recommendation needs `--reason`, which is the "skip a higher-scoring bead elsewhere" case, an
ordinary `stay` with a reason. The recommendation, both scores and the trail entry are untouched,
and a trail entry already written with `move` still reads as it was written.
