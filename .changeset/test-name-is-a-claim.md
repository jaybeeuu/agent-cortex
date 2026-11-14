---
"@jaybeeuu/agent-cortex": minor
---

Make a test's name an assertion contract, and require a mutation check before a test is done.

`style-tests` now states that every clause of a test name must be an assertion: a count in the name
asserts a count, a state asserts that state, and a "not" asserts the absence. The Workflow gains the
mutation check — disable the claimed behaviour and confirm each named test fails — and Red Flags
names the case that motivated it, a test named "one notice" proven only by `toBeDefined()`. The
worked pair lives in `EXAMPLES.md` under _A test name is a claim_. The review playbook now requires
the reviewer to map each clause of a changed test's name to the assertion that proves it, to reject a
test whose name outruns its assertions, and to say whether the mutation check ran.
