---
"@jaybeeuu/agent-cortex": patch
---

Fix release pipeline regenerating generated plugins after version bumps: the Version Packages action now runs `build:claude` and `build:copilot` after versioning so `claude/.claude-plugin/plugin.json` never goes stale