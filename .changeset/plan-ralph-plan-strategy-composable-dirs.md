---
"@jaybeeuu/agent-cortex": patch
---

Add composable agent directory structures for the plan, ralph-plan, and strategy agents (`agents/plan/`, `agents/ralph-plan/`, `agents/strategy/` with per-harness `pi/`, `copilot/`, and `claude/` frontmatter). The existing flat `*.agent.md` files are retained until the composer/installer migration lands, so no shipped behaviour changes yet.
