---
"@jaybeeuu/agent-cortex": patch
---

Split the `style-tests` example catalogue into a new `EXAMPLES.md` and broaden it into
`❌ Instead` / `✅ Write` code pairs across eight categories: behaviour over implementation,
test data (vital visible / incidental hidden), mocking at boundaries, targeted assertions,
structure and naming, determinism and async, isolation, and content assertions. Red Flags gains
the recurring anti-patterns — assertion-free and tautological tests, expected values recomputed
with the implementation's own logic, `.only`/focus left in, sleeps and real clocks, unawaited
promises, and log-output assertions — and the verification checklist gains matching gates.
`SKILL.md` drops back to a lean 146 lines so the principles still load with the skill while the
deepened examples live behind progressive disclosure. The `createSomething` factory example is
corrected: it had a missing comma (a syntax error), asserted `prop: 0` while overriding with
`prop: 1`, and reached for `DeepPartial` where `Partial` reads better for a flat type.
