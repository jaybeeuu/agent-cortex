---
"@jaybeeuu/agent-cortex": patch
---

`agent-cortex update --all` and `agent-cortex self-update` now refresh only the harnesses that are
installed. A harness that was never installed is reported as `not installed` — its own state, not a
stale version — and left alone, so neither command materialises an install nobody asked for.
Naming an absent harness on the command line is an error that points at
`agent-cortex install <harness>`, because update never installs anything.
