---
"@jaybeeuu/agent-cortex": minor
---

Build the Copilot plugin into a committed, self-contained `copilot/` subtree. `agent-cortex install copilot` (and `pnpm build:copilot`) now generate `copilot/plugin.json` (the root manifest shape with `agents`/`skills` pointed at `./agents`/`./skills` and the version tracking `package.json`), the composed `copilot/agents/*.agent.md`, a token-substituted `copilot/skills/<group>/<name>/` tree, and `copilot/hooks.json`. The root `agents/*.agent.md` flat files are retired in favour of the subtree, and CI now drift-checks the committed `copilot/` output.
