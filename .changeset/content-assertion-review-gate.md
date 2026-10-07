---
"@jaybeeuu/agent-cortex": patch
---

Enforce the content-assertion ban at the review gate: the `create-task` review template and the
`run-pipeline-stage` review playbook now name a test that asserts static file contents — an
expected config, markdown, terraform, or static snapshot — as a required finding that sets
`REVIEW_OUTCOME: CHANGES_REQUESTED`, explicitly carrying it out of the "not stylistic
preferences" instruction. The check is phrased as "the assertion does not prove the behaviour
under test" and is distinguished from a legitimate golden-output test whose expected value is a
product of the behaviour under test.
