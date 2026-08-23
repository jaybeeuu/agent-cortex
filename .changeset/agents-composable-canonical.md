---
"@jaybeeuu/agent-cortex": minor
---

Make the composable agent directories (`agents/<name>/`) canonical: the hand-authored flat `agents/*.agent.md` sources are removed and the flat Copilot/pi agent files are now generated output, composed from the canonical dirs by `scripts/build-copilot-agents.mjs` (`pnpm build:copilot`). `claude/agents/*.md` is composed from the same dirs' `claude/` harness by `scripts/build-claude-agents.mjs` (ralph stays native via `agents-native/ralph.md`). Agent names, descriptions, and tool sets are unchanged; agent bodies now carry the composable (tokenized) content. CI verifies both generated outputs never drift.