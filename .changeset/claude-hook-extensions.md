---
"@jaybeeuu/agent-cortex": minor
---

Port the pi extensions with Claude equivalents to the Claude Code plugin's hooks:
SessionStart now also injects the using-agent-skills / bd-tool / git-workflow skill
policy, and a Notification hook matched on documented notification types
(`agent_completed|agent_needs_input|permission_prompt`) raises desktop notifications
via the bundled `hooks/scripts/notify.mjs`. Hook support scripts are now bundled
into `claude/hooks/` by the shared installer, and the audit (auto-name, skill-stats,
subagent, agent-modes rejected with rationale) is recorded in `docs/claude-hooks.md`.