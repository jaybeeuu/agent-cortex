---
"@jaybeeuu/agent-cortex": patch
---

Prove that a refused boundary decision records nothing. The two refusal cases in
`test/boundary.test.mjs` now assert an empty trail as well as the message: `--decide` with an
outcome outside the three, and a decision against the scores with no `--reason`. The fake `bd` in
`test/helpers/fake-bd-queue.mjs` already records every `note` call, so the shared harness now
returns the trail a refused build left behind. A comment that claimed a parser refused a
bad `--decide` before the builder saw it was wrong: the builder checks the runtime value itself,
because the union is a compile-time constraint only. No behaviour changes.
