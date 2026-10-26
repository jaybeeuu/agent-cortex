---
"@jaybeeuu/agent-cortex": patch
---

Fix subagents starting with no tools at all. `agent-cortex install pi` rendered
each generated agent's tool list as one space-separated scalar
(`tools: "bash read grep find task …"`), but every consumer splits that scalar on
commas: the subagent extension turned it into `pi --tools "<one bogus name>"`,
whose allowlist matched no tool, so delegated agents (ralph, pipeline workers)
ran with only MCP tools and reported the `task` tool — and every other tool — as
missing. The pi renderer now emits the comma-separated form that
`parseFrontmatter`, the subagent extension, and `pi --tools` all agree on;
`parseToolList` in the subagent extension and agent-modes' flat-frontmatter
parser accept comma- and whitespace-separated lists so a re-render cannot
silently zero out a tool list again; and a round-trip test asserts a rendered
agent's tools survive the parse.
