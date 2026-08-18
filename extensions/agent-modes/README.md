# Agent Modes Extension

Makes the agent-cortex agents (ralph, ralph-plan, plan, strategy) available as
switchable PI modes. Each mode injects the agent's full system prompt into the
running context, restricts tools to the agent's declared tool set, and shows a
status indicator with the active agent name.

## Usage

| Command | Description |
| --- | --- |
| `/agent` | Show the agent mode selector |
| `/agent <name>` | Switch to an agent mode directly (e.g. `/agent ralph`) |
| `/agent default` | Return to default mode (full tool access) |
| `Ctrl+Shift+A` | Cycle through agent modes |
| `--agent <name>` | Start PI in a specific agent mode |

## How agents are discovered

Agents are read from the **composable source format** in the package's
`agents/` directory:

```
agents/<name>/
├── agent.md             # Shared body (harness-agnostic)
└── pi/
    ├── frontmatter.json # PI metadata: name, description, tools
    └── <section>.md     # Optional sections referenced by {{SECTION:name}}
```

The PI system prompt is composed from `agent.md` per the token-map.json
contract:

1. `{{SECTION:name}}` tokens are replaced with the agent's `pi/<name>.md`.
2. `{{TOOL:key}}` / `{{PATH:key}}` tokens are substituted against the pi column
   of `token-map.json`, with the plugin root resolved from the actual extension
   location. Tools without a PI equivalent (`ask_user`, `skill`) are omitted
   from the tool set.

Flat `agents/*.agent.md` files are still parsed as a fallback for agents that
have not been migrated to composable directories (retained until the
composer/installer migration). A composable directory always wins over its flat
counterpart for the same agent id.

## Development

Discovery and prompt composition live in `discover.ts` (unit-tested against
fixture directories in `discover.test.ts`); `index.ts` only wires discovery
into the extension API.

```bash
pnpm test        # run discover.test.ts
pnpm typecheck   # tsc --noEmit
```