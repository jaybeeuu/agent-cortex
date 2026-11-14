---
"@jaybeeuu/agent-cortex": minor
---

Rejections now carry data. A review that rejects a bead applies exactly one `defect:<class>` label
from a closed list of eight classes — `test-unproven`, `test-cannot-fail`, `criteria-unmet`,
`scope-creep`, `style-violation`, `missing-proof`, `regression`, `docs-drift` — plus the specific
reason in the rejection text.

The new `review-defects` skill defines the vocabulary, with one worked example per class in
`EXAMPLES.md`. The review playbook instructs one label per rejection, states that a class outside
the list is a review defect in itself, and says the review that confirms a fix removes the label and
records the removal in its trail entry. The label classifies the defect; the bead's status still
says where the work is, so no state label is added. `bd-tool` documents the vocabulary and the two
queries that read it: one class with `bd list -l defect:<class>`, and every open defect with
`bd list --label-pattern 'defect:*'`.
