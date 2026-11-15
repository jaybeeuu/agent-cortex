---
name: review-defects
description: The closed vocabulary of `defect:<class>` labels a reviewer applies to a rejected bead, so rejections become countable data. Use when rejecting a change, when deciding which class names a finding, or when querying which defects recur.
---

# Review defects

A rejection says what is wrong. The class says *which kind* of wrong, in one word, so rejections can
be counted, compared and trended across tasks instead of re-read one at a time.

## One closed list, one label per rejection

Apply exactly one class from this table. Never invent one.

The **Distinct from** column is part of the definition: two classes that sound alike are separated
there, and a finding that matches the neighbour belongs to the neighbour.

| Class | The defect | Distinct from | Evidence the rejection must show |
|---|---|---|---|
| `test-unproven` | A test's name claims a requirement its assertions never check. | `test-cannot-fail`: there the assertion is genuine and the case is absent. | The named clause, and the assertion that is missing. |
| `test-cannot-fail` | An assertion passes against a broken implementation. | `test-unproven`: a name that outruns its body, not an assertion that cannot bite. | The case that should fail and does not. |
| `criteria-unmet` | A criterion from the bead is not delivered. | `scope-creep`: too little work, not more than was asked. | The criterion, quoted, and what is absent. |
| `scope-creep` | The change does more than the criteria ask. | `criteria-unmet`: the change is wider than its reason. | The touched behaviour that no criterion names. |
| `style-violation` | A `style-*` rule is broken. | `unsafe-instruction`: a convention broken, not a machine put at risk. | The rule, quoted, and the line that breaks it. |
| `missing-proof` | A report claims success with no evidence. | `silent-degradation`: evidence absent, not evidence that cannot be wrong. | The claim, and the command output that is absent. |
| `regression` | Behaviour that worked before now breaks. | `criteria-unmet`: it breaks something nobody asked to change. | The old behaviour, and the check that now fails. |
| `docs-drift` | Shipped text no longer matches what ships. | `ambiguous-rule`: drift is **stale**; ambiguity is **readable two ways**. | The text, and the behaviour that contradicts it. |
| `unsafe-instruction` | Shipped text that, followed on an arbitrary machine, could destroy data or run something dangerous — destructive commands, force-pushes, credential handling, overwriting user config. | `docs-drift`: the text is still true, and the hazard is the point. `style-violation`: a convention, not a consequence. | The text, quoted, the state it endangers, and a safe form to use instead. |
| `ambiguous-rule` | Wording a reasonable agent reads two ways, especially a phrase true of one context that reads as true of another. | `docs-drift`: true yesterday, false today. `criteria-unmet`: behaviour delivered, not wording. | Both readings, quoted, and the one the author intended. |
| `silent-degradation` | A path that fails quietly or passes vacuously: a skipped check reported as success, a null mapping silently dropping a token, a guard that cannot fail. | `test-cannot-fail`: one assertion that cannot bite; this is any path that cannot report. | The quiet path, what it should have reported, and the run that shows it. |
| `unclassified` | The defect matches no class. It exists so a reviewer never force-fits. | Everything: it is the honest answer when none of the others is true. | The finding, the classes considered and why each fails, and the gap bead filed for the missing class. |

Two findings of different kinds are two entries in the rejection text and one label: the class of
the finding that must be fixed first.

## A class is a classification, not a state

The bead's own status still answers "where is this work?". The label answers "what kind of defect
was this?" — so never use it to mean blocked, in progress or done, and never add a parallel state
label.

## Apply it

1. Name the class in the rejection text, next to the specific reason.
2. Apply it to the bead whose work you reject:

   ```bash
   bd update <id> --add-label defect:test-unproven
   ```

   That bead is normally already closed — a pipeline closes the chore whose work is rejected before
   the review runs — and the label attaches to it anyway. So the queries below pass `--all`.

3. Write the specific reason — the file, the line, the missing assertion — in the rejection text.
   The label is queryable; it is never the whole message.

## Remove it when the fix closes

The review that confirms the fix removes the label, so the vocabulary describes only defects whose
fix is unconfirmed:

```bash
bd update <id> --remove-label defect:test-unproven
```

Record the removal in that review's trail entry ("`defect:test-unproven` cleared"), not as a label.
A closed defect is a fact in the trail, not a second class.

## No class fits: the escape hatch

Apply `defect:unclassified` when none of the classes above describes the finding. It exists so you
never force-fit, because a forced label corrupts the aggregate the feedback loop reads: the classes
are counted, so a `docs-drift` label on a dangerous instruction reports a text problem where the
risk was a machine at risk.

Applying it carries an obligation. The class is not a pass:

1. Say in the rejection text that no class fits, and name the classes you considered.
2. File a bead proposing the class that should have covered the finding, with this finding as its
   case.
3. Name that bead in the rejection text.

Without step 2 the label records a defect and teaches nothing — silent degradation of the aggregate,
which is the exact failure the class exists to prevent. An escape hatch without the bead is a
miscount with a nicer name.

## A label off this list is not a class

Any other `defect:*` label is not a class: the report prints it as vocabulary drift and counts it as
nothing. Inventing one is a review defect, and the escape hatch is the only honest way to say "no
class fits".

The vocabulary stays closed. A class is added by changing this file with the owner, never invented
inside a review, and adding one does not licence the next reviewer to add another. Applying a class
that does not fit is a review defect in itself, whatever the class: a label is never a near-miss.

## Query it

```bash
bd list -l defect:test-unproven --all        # one class, any status
bd list -l defect:unclassified --all        # the escape hatch: each names the gap bead filed
bd list --label-pattern 'defect:*' --all     # every defect, any class
```

`--all` is not optional. `bd list` hides closed beads by default, defects are historical data, and
the bead carrying one is usually closed: drop the flag and the query reports "No issues found" on
a label that is set.

Count the pattern output per class to see what recurs, and fix the process that produces it — a
class that keeps appearing is a gap in the stage before this one.

## Worked examples

`EXAMPLES.md` carries a case per class, with the rejection text a reviewer should write. Eleven are
real observations; `scope-creep` is a described situation, because no recorded case exists.

## See Also

- [review-security](../review-security/SKILL.md) — the security verdict that precedes any rejection.
- [review-report](../review-report/SKILL.md) — counts these classes across a project and files the recurring ones upstream.
- [run-pipeline-stage](../../workflow/run-pipeline-stage/SKILL.md) — the stage that applies these labels.
- [bd-tool](../../productivity/bd-tool/SKILL.md) — labels, notes and statuses.
