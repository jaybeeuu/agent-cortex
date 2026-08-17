# token-map.json — multi-harness token substitution

`token-map.json` is the central, single-source mapping of **tool names**, **paths**, and
**agent naming conventions** across the three harnesses this repo ships to. It is the
foundation for the install-time generation system: each harness installer (`agent-cortex
install <harness>`) reads the map and substitutes `{{TOOL:...}}` / `{{PATH:...}}` tokens in
the files it generates.

**The substitution contract lives inside `token-map.json`** (the `contract` section) — that
file is the single reference installers must implement. This README explains the design
decisions behind the map.

## Harnesses

| id | Platform | Agent format | Plugin root |
|---|---|---|---|
| `copilot` | GitHub Copilot CLI | `agents/*.agent.md` (canonical) | `~/.copilot/installed-plugins/_direct/agent-cortex` |
| `pi` | pi coding agent | `agents/*.agent.md` (canonical) | `~/.pi/agent/npm/node_modules/@jaybeeuu/agent-cortex` |
| `claude` | Claude Code | `claude/agents/*.md` (generated) | `${CLAUDE_PLUGIN_ROOT}` (env var) |

The harness ids match the values accepted by `agent-cortex install <harness>` in
`lib/cli.mjs` (`SUPPORTED_HARNESSES`).

## Design decisions

### 1. Token naming convention: `{{TOOL:name}}`, not `{{tool.name}}`

`agents/README.md` (ADR #63) already standardised `{{TOOL:name}}`, `{{PATH:name}}`, and
`{{SECTION:name}}` for the composable agent directory format. The map adopts that grammar
rather than inventing a dotted form:

- **The convention is established** — skill authors and the ADR already write tokens this
  way; the map should not fork the language.
- **Upper-case type prefix disambiguates** — `{{TOOL:read}}` (a tool) can never collide with
  `{{PATH:read}}` (a path) in the same document.
- **One namespace per type** — tool keys, path keys, and section names never share a lookup
  table, so a tool called `skills_dir` would not shadow the path key.
- **Greppable and schema-friendly** — simple `{{TYPE:NAME}}` is trivially matched by a
  regex; delimiters make unbalanced/typo'd tokens visible.

### 2. What is mapped

- **`tools`** — the twelve canonical tool names as authored in `agents/*.agent.md`
  (copilot names are the authoring names). Each row gives the equivalent tool name per
  harness. Source of truth for the copilot → claude half is the `TOOL_MAP` in
  `scripts/build-claude-agents.mjs` (PR #57); the pi column is grounded in pi's documented
  built-in tool surface (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) plus
  `task` / `read_agent` subagents.
- **`paths`** — `plugin_root`, `agents_dir`, and `skills_dir`. These are the install-time
  variables that differ per harness. `plugin_root` is the anchor; the other two resolve
  relative to it (`{base, relative}` specs) so a harness only overrides the single root it
  actually installs into.
- **`agents`** — the `agent-cortex:` name-prefix convention per harness (claude strips the
  prefix during conversion) and the deferred-agent exception (claude's `ralph` is authored
  natively, never generated). Agent names themselves do not get per-row mappings because
  the prefix rule covers all of them; the deferred list captures the only structural
  difference.
- **Deliberately not mapped:** hook patterns, MCP servers, and tool descriptions. Those
  differ *structurally* per harness (different hook event names, different config files),
  not by a single substitutable token; each installer already hardcodes its own shape. The
  map records them in `notes` where a tool differs in behaviour (`read_agent`, `skill`,
  `ask_user`).

### 3. Null mappings

A null value means **"this harness has no equivalent"** — not "empty string" and not "leave
the token as-is". The contract defines the two contexts:

- **Prose** (e.g. `Use {{TOOL:read_agent}} to poll`): the token is dropped and the
  installer warns. Dangling sentences after a drop are the author's responsibility — the
  warning exists so the installer surfaces them.
- **Tool-list frontmatter** (e.g. `tools: [..., "read_agent"]`): the entry is omitted from
  the array.

Unknown (unmapped) tokens are a **hard error**, not a null — a silently-passed-through
token is exactly the bug the map exists to prevent, and mirrors the build script's
`unknown tool "x"` throw.

### 4. Token substitution contract

The full contract is embedded in `token-map.json` under `contract`. In summary, installers:

1. Bind a harness id (`copilot` | `claude` | `pi`).
2. Substitute in order: `SECTION` (left for the composer), then `TOOL`, then `PATH`.
3. For `TOOL`: look up the canonical key, replace with the harness name; null → drop/omit;
   unknown → throw.
4. For `PATH`: named key → resolve from `paths`; anything else → resolve relative to
   `plugin_root`; `${ENV_VAR}` values pass through verbatim for runtime expansion.
5. Reject a map `version` they do not implement.

## Authoring guidance

- Write tokens with the **canonical (copilot) names**: `Use {{TOOL:task}} to spawn
  subagents`, `Read {{PATH:skills/workflow/plan/SKILL.md}}`.
- Never embed a harness-specific name in the canonical sources (`agents/*.agent.md`,
  `skills/**/SKILL.md`) — that defeats the map. The generated `claude/` subtree and any
  installed copies are the only places substituted names appear.
- When you add a new tool to an agent's frontmatter, add a row to `tools` in
  `token-map.json` in the same change — the contract treats unknown tools as errors, so a
  missing row breaks the install pipeline loudly instead of silently.

## Related

- `agents/README.md` — composable agent directory format (ADR #63), defines the token
  grammar the map implements.
- `scripts/build-claude-agents.mjs` — PR #57 build script whose `TOOL_MAP` is the
  reference data for the copilot → claude half of `tools`.
- `lib/cli.mjs` — `SUPPORTED_HARNESSES`, the install command surface the harness ids come
  from.