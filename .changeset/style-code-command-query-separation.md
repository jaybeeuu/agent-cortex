---
"@jaybeeuu/agent-cortex": patch
---

Add a command/query-separation rule to `style-code`: a function either returns a value or
changes state — never both. Commands mutate and return nothing; queries are pure and return a
value. Two carve-outs: a command that can fail may return a typed result (`Result<T, E>`) rather
than throw, and a fluent builder may return `this` to chain. Returning data about a mutation —
the saved row, a count, the previous value — is no longer permitted. The existing result-object
guidance is unchanged.
