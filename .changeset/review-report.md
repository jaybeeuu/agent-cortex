---
"@jaybeeuu/agent-cortex": minor
---

Add the `review-report` skill: one report from the `defect:<class>` labels a project's reviews
applied. `scripts/report.mjs` reads the tracker twice, both read-only and both with `--all` — the
defect query `bd list --label-pattern 'defect:*' --all` and the chore tree — and prints the top three
classes with counts, two example bead ids and the shipped skill that owns each failing rule, the
first-pass review rate derived from `stage:review` chore counts per parent, fix rounds grouped by the
stage the fresh chore re-runs, and the change against a report kept at `--baseline`. The class
vocabulary is not duplicated: the script parses the closed list out of `review-defects/SKILL.md`, so a
class that appears as a label without being in that table is reported as vocabulary drift and never
counted. Filing is a separate `--file` step that runs `gh issue create` with an argv array; without
the flag the script makes no network call, and it never pushes, opens a pull request or merges. The
feedback repository is configuration — `--repo`, then `AGENT_CORTEX_FEEDBACK_REPO`, then the
`repository` field of the manifest the running install ships (the staged pi package's
`package.json`, whose manifest now carries that field, or the staged Claude plugin's
`plugin.json`) — so no repository is hardcoded, a consuming project's own manifest is never used,
and a copy with no resolvable manifest fails with a message instead of filing somewhere wrong.
The report is printed before the filing target is resolved, so that failure leaves the measurement
on stdout and the reason on stderr. Absent data
is never dressed as a measurement: no label, a single label, no review chore and no baseline each get
a sentence saying so rather than a zero or a trend. `review-defects` gains a link to it.
