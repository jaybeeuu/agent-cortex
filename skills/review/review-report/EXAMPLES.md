# Review report — worked examples

Four real runs, one per degradation case. Each prints the same five sections; what changes is
what the tracker held. The project names and bead ids are fixtures, the output is verbatim.

## No label at all

Four beads, one change, one review chore, no `defect:` label anywhere:

```
Defect report — acme/nolabels
Reported 2026-05-01T10:00:00Z. Read 4 beads from the tracker.

Defects by class — `bd list --label-pattern 'defect:*' --all`
  No defect label is set on any bead, closed beads included. There is nothing to count,
  so no zero is printed as if it were a measurement.

First-pass review rate
  1 of 1 review cohorts passed with no fix round — 100%
  A cohort is a parent holding at least one stage:review chore; a rejected review always
  creates a fresh one, so a parent with exactly one passed first time.

Fix rounds
  No stage:fix chore is recorded in this tracker.

Change since the previous report
  None — no previous report was named. This is a snapshot, not a trend.
  Pass --baseline <path> to compare against one, and --record to keep this one.

A defect label is removed when the review that confirms its fix runs, so every count
above is the unconfirmed defect set at this moment, not the history of defects.
```

The pipeline numbers are still real. Only the defect section degrades, and it degrades by saying
so: `0 defects` would have read as a measurement.

## One labelled defect

The same tracker after a review rejected the change once:

```
Defects by class — `bd list --label-pattern 'defect:*' --all`
  1. criteria-unmet  1 defect in 1 change · owners: implement-task/SKILL.md, create-task/SKILL.md
     example: acme-2q.3
  1 unconfirmed defect across 1 change.

First-pass review rate
  0 of 1 review cohorts passed with no fix round — 0%

Fix rounds
  1 in total across 1 change — review 1
```

The report names the owning skill for the class and the bead that carries the label. The trend
section still reads "None — no previous report was named": one label is a snapshot, and a
direction needs a second report to compare against.

## The whole vocabulary

Eight labels, one per class, spread over four changes. The defect section prints the top three and
summarises the rest:

```
Defects by class — `bd list --label-pattern 'defect:*' --all`
  1. criteria-unmet  1 defect in 1 change · owners: implement-task/SKILL.md, create-task/SKILL.md
     example: acme-5q.3
  2. docs-drift      1 defect in 1 change · owners: maintain-agent-docs/SKILL.md, style-documentation/SKILL.md
     example: acme-6q.3
  3. missing-proof   1 defect in 1 change · owners: implement-task/SKILL.md, run-pipeline-stage/SKILL.md
     example: acme-4q.3
  8 unconfirmed defects across 4 changes. Top 3 of 8 classes.
```

This is the owning-skill mapping in use. Each of the eight classes maps to at least one shipped
skill, the report names the file to change rather than the symptom, and the suite fails if a mapped
skill disappears or a vocabulary class has no owner.

`--json` prints all eight classes with their counts, their changes and their bead ids, for a caller
that needs the whole table rather than the top three.

## With a previous report

The same project, recorded as a baseline one month earlier and re-run after two more rejections:

```
Change since the previous report
  Against /tmp/rr-example/trend/.agent-cortex-docs/defect-report.json, reported 2026-04-01T09:00:00Z
  criteria-unmet 1 (+1), docs-drift 1 (+1), missing-proof 1 (+1), and 5 more
  First-pass review rate 75% (from 75%, no change)
```

The comparison reads the report the script wrote at `--baseline`, so it compares like with like.
A class that did not change is not listed; when no class changed, the section says so. A baseline
file with an unrecognised schema is refused rather than read as zeros, because a baseline that
cannot be read must not become an invented trend.
