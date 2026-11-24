---
"@jaybeeuu/agent-cortex": major
---

`{{TOOL:x}}` becomes `{{CAPABILITY:x}}`, and `token-map.json`'s `tools` table becomes
`capabilities`. Rename every token in a skill or agent your own repository authors: an old
`{{TOOL:...}}` token is no longer substituted, so it reaches the harness as literal text and the
tool line it belonged to is lost.

Each capability row now binds `{ "name": …, "type": "tool" | "command" }` per harness, or `null`.
A string shorthand is refused at load with an error naming the row, because a name without a kind
cannot be checked. A `command` is user-invoked and may appear in prose only, so a tool list that
names one is refused with an error naming the canonical key. The kind is per harness, because the
same capability differs between them: `flush_window` is a tool on pi and a command on claude.

The agents this package ships render byte-identically on both harnesses; only the grammar a
consumer writes changed.
