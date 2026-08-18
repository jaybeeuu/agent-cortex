---
"@jaybeeuu/agent-cortex": minor
---

Update the agent-modes extension to discover agents from the composable directory format (`agents/<name>/` + per-harness `pi/frontmatter.json`). The PI system prompt is composed from `agent.md`, resolving `{{SECTION:...}}` includes from the agent's `pi/` directory and substituting `{{TOOL:...}}` / `{{PATH:...}}` tokens via token-map.json, so tool restrictions now translate to real PI tool names (e.g. `view` → `read`, `web_fetch` → `fetch_content`, null-mapped tools dropped). Flat `*.agent.md` files remain supported as a fallback for agents that have not been migrated to composable directories yet.