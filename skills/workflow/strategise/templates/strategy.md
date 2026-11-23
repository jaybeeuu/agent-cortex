# Prioritisation strategy

<!--
This file is the rubric a scorer reads before it judges a bead's reach, impact,
confidence and effort. Keep it short enough that you actually maintain it.

It lives in the repository as a committed file, never in the tracker, so a reviewer can
diff how the judgement changed. Every `##` section below is required: leave one empty and
the validator names it. `## Deadline tiers` and `## Impact levels` are the two exceptions —
omit either and the queue ranks on its documented deadline default, or `score` accepts any
impact value of zero or more. Set the version and the date with
`node <strategise-scripts>/strategy.mjs bump` after you edit the content.

`<strategise-scripts>` is the absolute path to the `scripts/` directory of the `strategise`
skill you loaded to get this template. It sits at `../scripts/` from this template's directory
inside that skill. The path varies by harness and install location, so never hardcode one. The
copy of this file in your repository carries no scripts of its own, so read the path from the
skill each time.
-->

- **Version:** 1
- **Updated:** YYYY-MM-DD

## Current themes

<!--
What you are optimising this month, as two to four themes. Name the outcome rather than
the feature: "shorter review turnaround", not "review tooling".
-->

## What counts as value

<!--
What a bead must change to be worth doing now. One line per value, written so a scorer
can answer yes or no: "unblocks a human gate", "removes a manual step".
-->

## How to judge confidence

<!--
When to score confidence low: no evidence in the repository, unclear scope, no known
user, an unproven dependency. Give the figure for each case, for example "0.3 with no
reproduction, 0.8 with a failing test".
-->

## Explicitly out of scope

<!--
Work you are deliberately not doing this month, however good it looks. A scorer reads
this to stop a shiny bead from outranking the theme.
-->

## How to calibrate effort

<!--
Anchor the effort scale to work you have recently completed here, so two scorers agree.
For example: 1 = half a day, one file; 3 = two to three days, one module with its tests;
5 = a week or more, several modules or a migration.
-->

## Impact levels

<!--
The scale an impact judgement lands on: one row per level, a label a rationale can cite and
the figure it is worth. `score` refuses an impact value that is not on this table and names
the rows it allows, so two scorers put the same bead on the same figure. Write each value
as a positive number, and keep every label and every value distinct: `validate` names a row
it cannot read, a zero or negative value, a repeated label and a repeated value.

The steps roughly double, so a `major` gain counts for much more than a `minor` one. A bead
that sits between two rows has to round, and the rationale should say which neighbouring
level it rejected and why.

Reach, confidence and effort get no table here, and that is deliberate: reach is a count
over a stated population, `## How to judge confidence` already bands the probability, and
`## How to calibrate effort` already anchors the cost. Impact is the one component the
rubric would otherwise leave to taste.

A strategy with no table accepts any impact value of zero or more, and `score` prints a line
saying so. There is no shipped default level set: unlike a deadline factor, a level set
decides whether a score is accepted at all, so a value the owner never named must not be
refused by one they never saw. Delete the table to lift the restriction; edit or add a row
to move it.
-->

| Level | Value |
|---|---|
| minor | 0.25 |
| small | 0.5 |
| normal | 1 |
| large | 2 |
| major | 3 |

## Deadline tiers

<!--
What a bd `--due` date does to a bead's rank in the HITL queue. The queue multiplies its
total by the factor of the narrowest row the remaining time fits inside, and a bead with
no deadline keeps the "more than" factor. Write each time as a number and one of `m`, `h`
or `d`, as in `within 1d`; read the rows in this order, narrowest first. A table needs
exactly one `overdue` row, exactly one `more than` row and at least one `within` row, and
`validate` names any row it cannot read.

A boundary belongs to the row that names it: exactly one day left earns 4, and a
millisecond more earns 2. A bead whose deadline is exactly now has not slipped yet, so it
is not overdue. A strategy with no table falls back to the queue's documented default, so
the rows below are the shipped values: edit a number, then `bump`, and the next queue run
uses it.
-->

| Remaining | Factor |
|---|---|
| within 1d | 4 |
| within 2d | 2 |
| within 7d | 1.5 |
| more than 7d | 1 |
| overdue | 8 |

## Change log

<!--
One line per change to this rubric, oldest first, written by
`node <strategise-scripts>/strategy.mjs bump --reason "<why>"`. The newest line must name the
version above: `validate` fails when the two disagree, because a version that moved with
no recorded reason is a rubric change nobody can review.
-->

