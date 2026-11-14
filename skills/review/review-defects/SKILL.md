---
name: review-defects
description: The closed vocabulary of `defect:<class>` labels a reviewer applies to a rejected bead, so rejections become countable data. Use when rejecting a change, when deciding which class names a finding, or when querying which defects recur.
---

# Review defects

A rejection says what is wrong. The class says *which kind* of wrong, in one word, so rejections can
be counted, compared and trended across tasks instead of re-read one at a time.

## One closed list, one label per rejection

Apply exactly one class from this table. Never invent one.

| Class | The defect | Evidence the rejection must show |
|---|---|---|
| `test-unproven` | A test's name claims a requirement its assertions never check. | The named clause, and the assertion that is missing. |
| `test-cannot-fail` | An assertion passes against a broken implementation. | The case that should fail and does not. |
| `criteria-unmet` | A criterion from the bead is not delivered. | The criterion, quoted, and what is absent. |
| `scope-creep` | The change does more than the criteria ask. | The touched behaviour that no criterion names. |
| `style-violation` | A `style-*` rule is broken. | The rule, quoted, and the line that breaks it. |
| `missing-proof` | A report claims success with no evidence. | The claim, and the command output that is absent. |
| `regression` | Behaviour that worked before now breaks. | The old behaviour, and the check that now fails. |
| `docs-drift` | Shipped text no longer matches what ships. | The text, and the behaviour that contradicts it. |

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

3. Write the specific reason — the file, the line, the missing assertion — in the rejection text.
   The label is queryable; it is never the whole message.

## Remove it when the fix closes

The review that confirms the fix removes the label, so the vocabulary always describes open
defects:

```bash
bd update <id> --remove-label defect:test-unproven
```

Record the removal in that review's trail entry ("`defect:test-unproven` cleared"), not as a label.
A closed defect is a fact in the trail, not a second class.

## An unknown class is itself a defect

A class that is not on the list above is not a label. Applying one is a review defect in itself:
state it in the rejection text, use the nearest real class for the finding, and raise the gap with
the owner. Do not extend the list inside a review — a vocabulary that grows per rejection counts
nothing.

## Query it

```bash
bd list -l defect:test-unproven        # one class, across open work
bd list --label-pattern 'defect:*'     # every open defect, any class
```

Count the pattern output per class to see what recurs, and fix the process that produces it — a
class that keeps appearing is a gap in the stage before this one.

## Worked examples

`EXAMPLES.md` carries one real case per class, with the rejection text a reviewer should write.

## See Also

- [review-security](../review-security/SKILL.md) — the security verdict that precedes any rejection.
- [run-pipeline-stage](../../workflow/run-pipeline-stage/SKILL.md) — the stage that applies these labels.
- [bd-tool](../../productivity/bd-tool/SKILL.md) — labels, notes and statuses.
