---
"@jaybeeuu/agent-cortex": minor
---

An agent's `tools` list gains one sentinel, `"*"`, meaning every tool the session has. The
composable schema keeps `tools` required and non-empty, so a forgotten list is still a validation
error rather than a silent grant; `"*"` must be alone, and both installers resolve it by omitting
the rendered `tools:` line, so a literal `*` never reaches `pi --tools` or Claude Code. The
harness then inherits its own full tool set, connectors included.

`guppi` now uses `"*"`, so it can read the tools that carry per-machine names — Confluence, Jira,
Slack, Datadog — instead of stopping mid-task to ask the human for a link. `agent-modes` resolves
the sentinel at activation from `pi.getAllTools()`, and reads an absent `tools` key in a flat agent
file as every tool; a file whose frontmatter cannot be parsed keeps the conservative default set.
