---
"@jaybeeuu/agent-cortex": patch
---

Migrate hardcoded tool names in skill files to `{{TOOL:name}}` tokens (task, read_agent, bash, view, rg, glob) so installers can substitute per-harness names.
