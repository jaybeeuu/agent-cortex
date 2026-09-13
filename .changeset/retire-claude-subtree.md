---
"@jaybeeuu/agent-cortex": minor
---

Retire the committed `claude/` plugin subtree: `agent-cortex install claude` into `~/.agent-cortex/claude` (with automatic marketplace registration) is now the only way to build the Claude Code plugin. Hand-authored extras moved to `claude-extras/`, the `build:claude` script is removed, and CI validates the installer instead of diffing committed output.
