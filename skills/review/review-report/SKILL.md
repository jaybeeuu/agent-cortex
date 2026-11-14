---
name: review-report
description: Reports the defect classes a project's reviews recorded, with the pipeline's first-pass review rate, fix rounds per stage and the change since the previous report, and files that report upstream. Use when you ask "what keeps failing", "defect report", "which skill should change", or "file this as package feedback".
---

# Review report

`review-defects` gives every rejection one class, so rejections become countable. This skill counts
them: one report naming which classes recur, the shipped skill that owns each failing rule, and the
pipeline's own rate — then, as a separate step, files that report upstream.

## When to use

- "What keeps failing?" — which defect class recurs across this project's changes.
- Deciding which shipped skill to change, because a class keeps appearing.
- Filing package feedback against the tool the project runs on.
- Checking whether the review gate is improving, without reading closed beads one at a time.

## When NOT to use

- Applying a class to a rejection — that is `review-defects`.
- Reviewing one change — that is the `review` stage.
- Reporting work progress — beads and `bd-tool` own that.

## What it measures

| Metric | Derived from the tracker |
|---|---|
| Defects by class | every `defect:<class>` label on any bead, closed beads included |
| First-pass review rate | parents holding exactly one `stage:review` chore |
| Fix rounds per stage | `stage:fix` chores, attributed to the stage the fresh chore re-runs |
| Change since the previous report | this report against the report kept at `--baseline` |

The class vocabulary is not defined here. `review-defects` owns the closed list of eight classes, and
the script parses that table at run time, so the words a reviewer applies and the words this report
counts cannot drift apart. A class that appears as a label but not in the table is printed as
vocabulary drift and is never counted as a class of its own.

A fix round is attributed by chore state, not by prose: a rejected stage always creates a `stage:fix`
chore plus a fresh instance of that stage, and the fresh instance declares a `blocks` dependency on
the fix. The stage label it carries is the stage the fix round repaired.

The class-to-skill mapping is `DEFECT_OWNERS` in `scripts/report.mjs` — one table, so a mapping edit
is one edit. The suite fails when a mapped skill does not exist on disk, or when a class in the
vocabulary has no owner.

## Honest by construction

The report never dresses an absent measurement as a number:

- **No defect label.** It says no label is set and prints no zeros, because zero labels is an absence,
  not a measurement of zero defects.
- **One labelled defect.** It prints the snapshot and says there is a single data point, so there is no
  trend yet.
- **No review chore.** It says no rate is reported, because absent is not zero.
- **No baseline.** It prints the snapshot and says there is no previous report to compare against.
- **Label removal.** A label is removed when the review that confirms its fix runs, so the counts
  describe the unconfirmed defect set at that moment, never the whole history. The trend compares
  snapshots and says so.

## Workflow

1. Run the report against the project:

   ```bash
   node <review-report-scripts>/report.mjs
   ```

   It reads two tracker queries, both read-only and both carrying `--all` — the defect query
   `bd list --label-pattern 'defect:*' --all` and the chore tree. Without `--all` a query for a label
   on a closed bead returns nothing.

2. Cross-check two numbers by hand before trusting the report: count one class with
   `bd list -l defect:<class> --all`, and count one parent's review chores with
   `bd children <id> --json`. The report is a summary of queries you can run yourself.

3. Keep a baseline when you want a trend. `--baseline <path>` compares against a report the script
   wrote earlier, and `--record` keeps this report there:

   ```bash
   node <review-report-scripts>/report.mjs --baseline docs/defect-report.json --record
   ```

   The path is yours to choose, and a committed one is the only kind that survives. `.agent-cortex/`
   is an ignored directory in a consuming project, and the working-docs directory is per-bead and lost
   with the worktree, so neither can hold a trend across branches or machines. Commit the file if you
   want the comparison to travel; leave it out of version control and the comparison is local.

4. Read the report before it leaves the machine. The default run writes nothing and calls nothing.

5. File it, once you have read it:

   ```bash
   node <review-report-scripts>/report.mjs --file
   ```

   `--file` is the only networked step, and it runs `gh issue create` — no push, no pull request, no
   merge, and nothing written to the repository it files against.

## Choosing the feedback repository

The repository is configuration, resolved in this order:

1. `--repo <owner/name>`.
2. `AGENT_CORTEX_FEEDBACK_REPO` in the environment.
3. The `repository` field of the manifest the running install ships — the `package.json` of the
   package `install pi` stages, or the `.claude-plugin/plugin.json` of the plugin `install claude`
   stages. A manifest is read only when it names this package, so a consuming project's own
   manifest is never used.

No repository slug is hardcoded, so an install files feedback to the package it was installed from.
Both installs declare that field, so `--file` needs no further configuration. A copy that carries
no such manifest — vendored into a project by hand, for example — cannot resolve one: `--file` then
fails with a message naming `--repo` and the environment variable, and the report is printed first,
so the measurement is never lost.

## Verification checklist

- [ ] The report printed counts that you can reproduce with the same queries by hand.
- [ ] Every top class named an owning skill, and one example bead id.
- [ ] The report was read before `--file` ran, and `--file` ran only if filing was wanted.
- [ ] With no labels or no baseline, the report said so instead of printing a trend.
- [ ] Nothing was pushed and no pull request was opened against the feedback repository.

## See Also

- [review-defects](../review-defects/SKILL.md) — the closed class vocabulary this report counts.
- [run-pipeline-stage](../../workflow/run-pipeline-stage/SKILL.md) — the stage that applies the labels and builds fix rounds.
- [style-tests](../../style/style-tests/SKILL.md) — the rule behind the `test-*` classes this report points at.

Reports for the three degradation cases are in `EXAMPLES.md`.
