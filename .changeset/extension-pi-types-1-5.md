---
"@jaybeeuu/agent-cortex": patch
---

Type-check the extensions against the pi version that is actually installed.

The extension workspaces pinned `@earendil-works/pi-coding-agent`, `pi-agent-core`, and `pi-ai` at
`^0.78.1` for `import type` only, while `pi --version` reported 1.5.2. `pnpm typecheck` therefore
validated against an API that no installed pi provides. The pins now follow the running CLI at
`^1.5.2`, and the `agent-modes` `ExtensionAPI` test double gains the members 1.5.x declares:
`registerMarkdownTransformer`, `registerEntryRenderer`, `registerToolRenderer`, `registerVirtualModel`,
`registerMcpServer`, `unregisterMcpServer`, `getMcpServers`, `unregisterVirtualModel`, and
`getSettings`, plus the unsubscribe return value of `on`.
