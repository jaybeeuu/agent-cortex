# Stage Playbook: reviewing

## Stage Instructions

1. Invoke the `review-security` skill first.
2. If security verdict is FAIL:
   - set `OUTCOME: BLOCKED`,
   - include each finding under `BLOCKING_ISSUES`,
   - stop further review.
3. Invoke `style-code` and `style-tests` for code and test review criteria.
4. Review for correctness, requirement alignment, and material quality issues.
5. Read the name of every changed test, then find the assertion that proves each clause of it. A
   count in the name needs a count assertion, a state needs that state, and a "not" needs the
   absence. Reject the test when any clause has no assertion, and name the missing clause under
   `BLOCKING_ISSUES`.
6. Say in the `SUMMARY` whether the mutation check from `style-tests` was run. A branch that adds
   or changes a test owes that check whether or not the bead asked for it. Block when the branch
   shows no evidence that it ran.
7. Do not request changes for stylistic preferences alone.

## Stage Outcome

- Set `OUTCOME: SUCCESS` if approved.
- Set `OUTCOME: BLOCKED` if changes are requested.
- If blocked, enumerate required changes under `BLOCKING_ISSUES`.
- `FILES_CHANGED` should be `none`.

## One defect class per rejection

A rejection carries exactly one `defect:<class>` label, from the closed list in the
`review-defects` skill, plus the specific reason in the rejection text. The label names the kind;
`BLOCKING_ISSUES` names this instance.

```bash
bd update <id> --add-label defect:test-unproven
```

- Apply it to the bead whose work you reject. That bead is normally the code chore, which the
  code stage already closed; the label attaches to it all the same, so the queries in
  `review-defects` pass `--all` and a query without the flag finds nothing. Two findings of
  different kinds are two `BLOCKING_ISSUES` entries and one label: the class of the finding that
  must be fixed first.
- A class that is not on the closed list is a review defect in itself. Say so under
  `BLOCKING_ISSUES` and use the nearest real class — never invent a `defect:` label.
- The review that confirms the fix removes the label
  (`bd update <id> --remove-label defect:test-unproven`) and records the removal in its trail
  entry. A closed defect is a trail fact, never a second class.

A test whose name outruns its assertions is `defect:test-unproven`; a test that would pass against
a broken implementation is `defect:test-cannot-fail`.

## Remediation and close

- You own this leaf bead: record the trail entry through `scripts/trail-entry.mjs`, then
  `bd close <id> --reason=...` on both outcomes (see `prompts/stage-runner.md`, _Trail entries_).
- `OUTCOME: SUCCESS` — create nothing; the orchestrator routes to `document`.
- `OUTCOME: BLOCKED` — count the parent's existing `stage:fix` children against
  `maxFixRounds` in `skills/planning/create-task/pipeline.json`. Under cap, create a
  `stage:fix` chore carrying the full `BLOCKING_ISSUES` list **plus a fresh `stage:review`
  chore** blocked on it (`bd dep add <fresh> <fix> --type blocks`), and re-block `document`
  behind the fresh bead. At cap, block the parent and create nothing.
