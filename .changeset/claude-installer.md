---
"@jaybeeuu/agent-cortex": minor
---

Add `agent-cortex install claude` — install-time generator for the Claude Code plugin
subtree, sharing one code path with `pnpm build:claude` so the outputs can never diverge.
`claude/.claude-plugin/plugin.json` (version now tracked from `package.json`) and
`claude/hooks.json` (from the new canonical `hooks/claude/` source) are generated rather
than hand-maintained, and the committed `claude/skills/` gains the previously-missing
`using-agent-skills` symlink. Root tests (`test/`) are now included in `pnpm test`.