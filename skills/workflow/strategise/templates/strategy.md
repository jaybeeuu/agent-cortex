# Prioritisation strategy

<!--
This file is the rubric a scorer reads before it judges a bead's reach, impact,
confidence and effort. Keep it short enough that you actually maintain it.

It lives in the repository as a committed file, never in the tracker, so a reviewer can
diff how the judgement changed. Every `##` section below is required: leave one empty and
the validator names it. `## Deadline tiers` and the four level tables — `## Reach levels`,
`## Impact levels`, `## Confidence levels`, `## Effort levels` — are the exceptions: omit one
and the queue ranks on its documented deadline default, or `score` accepts any value that
component's floor allows. Set the version and the date with
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
it cannot read, a zero or negative value, a repeated label and a repeated value. A line here
that opens with a pipe must divide into exactly two cells, and `validate` names the one that
does not rather than skipping it, because a dropped row would narrow the allowed set in
silence. A defective row makes the whole file invalid, so no bead is scored against it until
you fix it.

The steps roughly double, so a `major` gain counts for much more than a `minor` one. A bead
that sits between two rows has to round, and the rationale should say which neighbouring
level it rejected and why.

Every component gets a table of its own: reach, confidence and effort follow this one, each
with the same shape, because a rule that binds impact and not reach invites a scorer to be
careful in one place and careless in three. The three sections after this one are that scale.

A strategy with no table accepts any impact value of zero or more, and `score` prints one
line naming impact as unconstrained. There is no shipped default level set: unlike a deadline
factor, a level set decides whether a score is accepted at all, so a value the owner never
named must not be refused by one they never saw. Delete the table to lift the restriction;
edit or add a row to move it.

The five rows below are a starting point, written so a first table parses. Replace them with
the scale you actually judge on: they are an example of the shape, not a recommendation the
tool prefers.
-->

| Level | Value |
|---|---|
| minor | 0.25 |
| small | 0.5 |
| normal | 1 |
| large | 2 |
| major | 3 |

## Reach levels

<!--
The scale a reach judgement lands on: one row per level, a label a rationale can cite and the
figure it is worth. `score` refuses a reach value that is not on this table and names the rows
it allows, so two scorers count the same population the same way.

Reach is a count, so every value here is a whole number of zero or more. `validate` names a
row it cannot read, a fractional or negative value, a repeated label and a repeated value, and
a line that opens with a pipe must divide into exactly two cells.

The rows below are a starting point. Replace them with the populations you actually count —
workflows, beads, people — and keep every label and every value distinct. A strategy with no
table accepts any reach of zero or more, and `score` says reach is unconstrained.
-->

| Level | Value |
|---|---|
| one | 1 |
| several | 5 |
| many | 20 |

## Confidence levels

<!--
The probabilities a confidence judgement may take: one row per level, a label a rationale can
cite and the figure it is worth. `score` refuses a confidence value that is not on this table
and names the rows it allows.

A confidence is a probability, so every value here is more than 0 and at most 1. `validate`
names a row it cannot read, a value outside that range, a repeated label and a repeated value.

Keep the rows consistent with `## How to judge confidence` above: that section says when to
score low, and this table says which figures are available at all. The rows below are a
starting point, not a recommendation. A strategy with no table accepts any confidence in
`0..1`, and `score` says confidence is unconstrained.
-->

| Level | Value |
|---|---|
| guessing | 0.3 |
| likely | 0.8 |
| certain | 1 |

## Effort levels

<!--
The costs an effort judgement may take, anchored to `## How to calibrate effort` above: one
row per level, a label a rationale can cite and the figure it is worth. `score` refuses an
effort value that is not on this table and names the rows it allows.

An effort is a cost, so every value here is greater than zero. `validate` names a row it
cannot read, a zero or negative value, a repeated label and a repeated value.

The rows below are a starting point. Replace them with the anchors you actually use, so a
scorer picks a figure the rubric named instead of inventing one. A strategy with no table
accepts any effort above zero, and `score` says effort is unconstrained.
-->

| Level | Value |
|---|---|
| half a day | 1 |
| two or three days | 3 |
| a week or more | 5 |

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

