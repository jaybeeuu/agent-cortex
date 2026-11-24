# Four-lens review

## Context

Review is one stage with one reviewer, and that reviewer is asked four different questions at once:
does the code do what it says, does the code and its tests meet the style we hold, do the tests prove
the acceptance criteria, and is the change safe. Whichever question the reviewer holds hardest wins
the pass, and the other three are covered by the sentence "otherwise looks fine".

The cost is visible in what escapes. A change whose tests name a requirement and assert none of it
passes review, because the reviewer was reading the diff for bugs at the time. And a rejection says
"rejected" without saying which question failed, so a fix round argues about opinion rather than
behaviour, and rejections cannot be counted by cause.

The stage's own playbook has grown to compensate: it asks for correctness, security and alignment in
one brief, which is a list of questions rather than a standard any single pass can hold.

## Decision

Review becomes four lenses, each judged independently:

1. **Behaviour** — the code does what it says: bugs, missed edge cases, unhappy paths.
2. **Quality** — the code and the tests meet the style guides.
3. **Tests** — the acceptance criteria are met; coverage is high as a signal and mapped to criteria;
   edge cases and unhappy paths are judged rather than counted; each test level earns its place; a
   suite larger than the risk is itself a finding.
4. **Security** — secrets, credentials, dangerous input handling, and the repository's existing scan.

Each lens is its own bead, created at planning time by `create-chores`, so a bead's tree grows from
seven chores to eleven. The four reviewer chores are independent, and a **coordinator** chore depends
on all four and consolidates their verdicts into one report.

Fan-in rules:

- Any rejecting lens rejects the bead.
- The coordinator consolidates and **may not overrule a lens**.
- One fix round, scoped to the findings.
- Only the lenses that rejected re-review, and each must pass.
- Every finding carries a `defect:<class>` label from the closed vocabulary, so a rejection names the
  question that failed and becomes countable.

A lens with nothing to review — security on a documentation-only change — closes with that verdict and
one line of evidence. It neither skips silently nor invents a finding.

## Rejected alternatives

- **Change-class routing.** Two pipelines, one for behaviour changes and one for text or config, with
  their own stage orders and testing requirements. Rejected: real changes sit between the two classes,
  and the classification was doing work that review should do.
- **One stage, three parallel reviewer roles.** Preserves the chore count, but a rejection leaves no
  artifact of its own, so no lens can be queried, retried or counted on its own.
- **Four sequential review stages.** Sharpest audit trail, and three fix loops per bead: any rejection
  restarts everything rather than the lens that rejected.
- **Subagents only, no beads.** Cheapest, and the reviewers leave no trail beyond the coordinator's
  report, which is the same loss of traceability as parallel roles.

## Consequences

- Every bead's tree becomes eleven chores. In a flat list the five review chores are unreadable without
  their `stage:` labels, and `bd ready` returns four review chores where it used to return one.
- "Nothing to review" is now routine rather than exceptional, so each lens needs a stated way to close
  on it — and a reason a reviewer cannot quietly manufacture a finding to look useful.
- Because the coordinator cannot overrule, a single strict lens can hold work up. That is accepted: the
  alternative is a lens whose verdict does not count, which returns the pipeline to one opinion with
  extra steps.
- `review-defects` gains a lens-to-class mapping, and the defect report gains a per-lens breakdown.
- The stage table in `skills/planning/create-task/REFERENCE.md`, the review playbook in
  `skills/workflow/run-pipeline-stage/`, and the `review-defects` vocabulary all change with the work.
  They are the current state, not the decision — this record is why.
