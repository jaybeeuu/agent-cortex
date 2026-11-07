---
"@jaybeeuu/agent-cortex": patch
---

Stop the Claude install from dropping `{{TOOL:read_agent}}` and `{{TOOL:wait_for_agents}}`
into dangling prose. Both tokens are null on the claude column (Claude reports a subagent's
result inline, so there is no separate read or wait step), so the installer replaced them with
an empty string and warned three times — leaving `Read the completed agent's output with  and
parse…` and two similar broken sentences in the installed `ralph` and `design-an-interface`
skills. Those sentences are now harness-neutral, so both installs read correctly and the
installer emits no null-mapping warning. A regression guard fails the installer test if a
shipped skill names a tool the claude column cannot map.
