---
"@jaybeeuu/agent-cortex": minor
---

Add a `wait_for_agents` tool to the subagent extension: it blocks until at least one background sub-agent (spawned with `task`) completes and returns its result, with `read_agent` kept as a fallback. Ralph's PI completion detection now waits on `wait_for_agents` instead of a `sleep 120` poll loop.