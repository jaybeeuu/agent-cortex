---
"@jaybeeuu/agent-cortex": minor
---

Add the Copilot CLI harness installer (`agent-cortex install copilot`), sharing the generator with `pnpm build:copilot`. It regenerates the flat `agents/*.agent.md` files the Copilot plugin loads (plugin.json `agents: "agents/"`), with the same `--dry-run` / `--output` contract as the claude and pi installers.