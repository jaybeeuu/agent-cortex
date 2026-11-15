---
"@jaybeeuu/agent-cortex": minor
---

Re-rank at every item boundary, with the comparison and the reason on the trail. `hitl-queue` gains
`boundary.mjs`: one command compares the theme's next item (the highest-ranked bead under the epic)
against the queue's top item, prints **both stored totals**, and says whether the scores point to
`stay` or `switch`. It computes no score — the totals, components and multipliers are the queue's —
and it recommends rather than switches: a run with no `--decide` writes nothing.

`--decide stay|switch|move` records the human's answer as one timestamped `bd note` on the theme
bead, carrying both scores and the reason, so a later session reads why the theme was kept or left.
A decision that contradicts the scores needs `--reason`, so an unexplained override cannot reach
the trail. A missing theme item, a named bead outside the queue and an empty queue are stated with
one next step instead of guessed.

The guppi agent gains its work unit: the theme is the current epic, a boundary is the completion of
one item, and every boundary ends in the documented trade-off — continue in the theme, switch
because higher-priority work waits elsewhere, or move because a break improves the next item. It
never leaves a theme without both scores on screen, and a wish for a different order stays a
`prioritise-work` change.
