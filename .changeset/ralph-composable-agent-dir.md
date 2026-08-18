---
"@jaybeeuu/agent-cortex": patch
---

Add composable agent directory structure for the ralph agent (`agents/ralph/` with per-harness `pi/`, `copilot/`, and `claude/` frontmatter and polling sections). The existing flat `agents/ralph.agent.md` is retained until the composer/installer migration lands, so no shipped behaviour changes yet.