---
"@jaybeeuu/agent-cortex": minor
---

The HITL queue gains a fourth multiplier: a per-theme balance read from the beads that already
exist. A bead's **theme** is its root ancestor, and `served(theme)` counts how many of the newest
`window` closes belong to it, skipping `stage:*` and `lifecycle:*` beads because a pipeline step is
not an item. The factor is `decay ^ served(theme)`, so a theme someone just worked in drops and a
neglected theme keeps its full weight.

Both numbers are configuration in an optional `## Theme balance` strategy section —
`parseThemeBalance`, `THEME_BALANCE_SECTION` and `DEFAULT_THEME_BALANCE` (`{ window: 5, decay: 0.7 }`)
in `strategise`, folded into `validate` and printed in the summary digest beside the deadline
factors. `decay: 1` disables the effect, an absent section applies the documented default, and the
row prints the theme factor and names the theme when it is not the row's own id. Nothing is stored
and nothing is written to a bead: the window is one `bd list --all` read per scope, ordered by
`closed_at`, so a stored RICE record never moves.
