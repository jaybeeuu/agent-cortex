# Prioritisation strategy

<!--
This file is the rubric a scorer reads before it judges a bead's reach, impact,
confidence and effort. Keep it short enough that you actually maintain it.

It lives in the repository as a committed file, never in the tracker, so a reviewer can
diff how the judgement changed. Every `##` section below is required: leave one empty and
the validator names it. Set the version and the date with
`node <skill-scripts>/strategy.mjs bump <path>` after you edit the content.
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
