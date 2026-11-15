# Prioritisation strategy

<!--
This file is the rubric a scorer reads before it judges a bead's reach, impact,
confidence and effort. Keep it short enough that you actually maintain it.

It lives in the repository as a committed file, never in the tracker, so a reviewer can
diff how the judgement changed. Every `##` section below is required: leave one empty and
the validator names it. `## Deadline tiers` is the one exception — omit it and the queue
ranks on its documented default. Set the version and the date with
`node <strategise-scripts>/strategy.mjs bump` after you edit the content.
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

