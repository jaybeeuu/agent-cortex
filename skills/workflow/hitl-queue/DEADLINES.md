# Deadlines

A `--due` date is the one deadline field, and `bd` already stores it. The queue multiplies the
total by the factor of the narrowest tier the remaining time fits inside. The table is the
strategy's to tune, the boundary is arithmetic, and the row prints what it applied.

## The shipped table

| Time left | Factor |
|---|---|
| more than a week | 1 |
| within a week | 1.5 |
| within two days | 2 |
| within a day | 4 |
| overdue | 8 |

Those numbers are the **shipped default**: a strategy with no `## Deadline tiers` section ranks on
this table, and so does a run whose header says `strategy unknown`.

## A strategy's table

The strategy's optional `## Deadline tiers` section carries the table a repository tunes, so
moving a tier is a strategy edit and a `bump`, never a code change. A row reads
`| <when> | <factor> |`, narrowest first, and `<when>` is `within <n><m|h|d>`,
`more than <n><m|h|d>` or `overdue`.

A table that is present must carry exactly one `overdue` row, exactly one `more than` row and at
least one `within` row, and `validate` exits 1 naming every row it cannot read — a malformed table
never falls back to the default in silence.

## Where a boundary falls

A boundary falls on the side that names it: with exactly one day left a bead earns 4, and a
millisecond more earns 2. A bead whose deadline is exactly now has not slipped yet, so it is not
overdue. A bead with no due date sits outside the tiers and keeps the factor 1, so tuning a row
never lifts undated work by accident.

## The deadline clause in a row

A ranked row shows the deadline, the time left and the factor, and an overdue bead is flagged
rather than lifted in silence:

```text
2  bd-2  8.0  rice 4.2 = R4 · I3 · C0.7 · E2  ×1.00 dependents(0)  ×1.0  deadline ×8 OVERDUE by 1d (due 2026-11-14T08:59Z)
```

An unscored row has no total to multiply, so it shows the due moment and `OVERDUE` with no factor
at all:

```text
-  bd-6  —  unscored — no rice metadata  OVERDUE by 2d 11h (due 2026-11-13T00:00Z)
```

## Deferral

`--defer` is bd's own field and bd's own rule, so the queue reads it rather than inventing a second
one. `bd ready` wakes a bead whose defer date has passed, while `bd list` keeps reporting the stale
`deferred` status it was parked in, so the queue applies that same wake rule to `defer_until`. A
bead deferred into the future is absent and counted; a bead whose defer date has passed is listed.
