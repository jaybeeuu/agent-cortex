# token-map.json — multi-harness token substitution

`token-map.json` is the central, single-source mapping of **capability names and kinds**,
**paths**, and
**agent naming conventions** across the two harnesses this repo ships to. It is the
foundation for the install-time generation system: each harness installer (`agent-cortex
install <harness>`) reads the map and substitutes `{{CAPABILITY:...}}` / `{{PATH:...}}` tokens in
the files it generates.

**The substitution contract lives inside `token-map.json`** (the `contract` section) — that
file is the single reference installers must implement. This README explains the design
decisions behind the map.

## Harnesses

| id | Platform | Agent format | Plugin root |
|---|---|---|---|
| `pi` | pi coding agent | `agents/<name>/` composable dirs (composed at runtime by agent-modes, or rendered install-time by `agent-cortex install pi`) | `~/.agent-cortex/pi` |
| `claude` | Claude Code | `~/.agent-cortex/claude/agents/*.md` (materialised home install) | `${CLAUDE_PLUGIN_ROOT}` (env var) |

The harness ids match the values accepted by `agent-cortex install <harness>` in
`lib/cli.mjs` (`SUPPORTED_HARNESSES`). The pi `plugin_root` row is the staged package
directory `agent-cortex install pi` materialises, which pi then loads by path; checkout
and symlinked installs pass `--plugin-root <dir>` to override it (see README "Pi package
staging (`agent-cortex install pi`)").

## Design decisions

### 1. Token naming convention: `{{CAPABILITY:name}}`, not `{{capability.name}}`

`agents/README.md` (ADR #63) already standardised `{{CAPABILITY:name}}`, `{{PATH:name}}`, and
`{{SECTION:name}}` for the composable agent directory format. The map adopts that grammar
rather than inventing a dotted form:

The type is **`CAPABILITY`, not `TOOL`**, because a row may name a command: a token is not a
promise that its argument is a model-callable tool.

- **The convention is established** — skill authors and the ADR already write tokens this
  way; the map should not fork the language.
- **Upper-case type prefix disambiguates** — `{{CAPABILITY:view}}` (a capability) can never
  collide with
  `{{PATH:read}}` (a path) in the same document.
- **One namespace per type** — capability keys, path keys, and section names never share a lookup
  table, so a capability called `skills_dir` would not shadow the path key.
- **Greppable and schema-friendly** — simple `{{TYPE:NAME}}` is trivially matched by a
  regex; delimiters make unbalanced/typo'd tokens visible.

### 2. What is mapped

- **`capabilities`** — the canonical capability names as authored in `agents/<name>/agent.md`
  (the canonical authoring names). Each row gives, per harness, `{ name, type }` or `null`:
  the harness's name for the capability, and what the harness actually exposes there.
  A `type` of `tool` is model-callable and may appear in a tool list; a `type` of `command`
  is invoked directly by the user or agent and may appear in prose only. There is no string
  shorthand — a name without its kind cannot be checked, and the loader refuses one.
  The kind is **per harness**, because the same capability genuinely differs between them:
  `interrupt_rewind` is a pi tool and a claude command, `flush_window` is a pi tool
  (`request_flush`) and a claude command (`/clear`). A row-level kind would be wrong for four
  rows.
  The claude column is consumed by `bin/installers/claude.mjs` (the install-time
  generator — PR #91, #92); the pi column is grounded
  in pi's documented built-in tool surface (`read`, `bash`, `edit`, `write`, `grep`, `find`,
  `ls`) plus `ask_questions` — added by the pi-questions package (mapped from
  `ask_user`) — and `task` / `read_agent` / `wait_for_agents` subagent tools, the last three
  supplied by this repo's own `extensions/subagent` rather than by pi; `skill` maps
  to `read` (skills load by reading the listed SKILL.md path).
  Two rows carry session-to-session messaging rather than a built-in tool: `peer_send` and
  `peer_list`. On claude they are Claude Code's own `SendMessage` and `ListAgents`; on pi they
  are the `pi-peer` package's tools, which the consuming repository installs itself. A row maps
  a **name, never a protocol**: the message kinds and the acknowledgement rule layered above
  the transport are harness-invariant text, so only the transport forks and the protocol stays
  in one authored copy.
  One row names who waits for a CI run that outlives a check's own wait window:
  `post_merge_watch`. Its two values differ in kind — this package's own `post-merge-watch`
  extension on pi, Claude Code's built-in `ScheduleWakeup` tool on claude — so the prose around
  it describes only what both do (the session resumes, the check runs again) and never a call
  shape. The kinds record the same fact: `tool` on claude, where the model calls it, and
  `command` on pi, where the extension registers a CLI flag the user starts the session with.
  Both values are a **self-paced re-prompt, not an event subscription**: the session asks to be
  woken and looks again on waking. Claude Code also supplies an event-watching `Monitor` tool,
  but that tool is gated behind a feature flag that defaults off, so a portable skill may not
  depend on it. Naming the re-prompt is what holds on every session; the playbook's prose
  fallback covers the session where even that is absent.
  Two rows name what a boundary's decision does to the window, and both are mixed-kind like
  `post_merge_watch`: the values differ because that is what each harness supplies. `compact_window`
  is the transition a **stay** makes — Claude Code's built-in `/compact` command on claude, this
  package's own `session-transition` extension's `request_compact` tool on pi — and it summarises the
  window while keeping its recent tail, so the next item on the theme continues from what the last
  one established. `flush_window` is the transition a **switch** makes — Claude Code's built-in
  `/clear` command on claude, the same extension's `request_flush` tool on pi — and it drops the
  window, carrying nothing into the replacement session. Neither row may be null: a null would drop
  the token and leave the sentence that named the mechanism short of a name. The prose around each
  row describes only what both values do — a summary that keeps a tail, and a reset that carries
  nothing — and never a call shape, so the rule outlives the mechanism changing. `flush_window`
  replaced `clear_window`, whose pi column named a session switch the model could not call; the rule
  it stated could not be acted on where it was stated.
- **`paths`** — `plugin_root`, `agents_dir`, `skills_dir`, and `skill_anatomy`. These are the
  install-time variables that differ per harness. `plugin_root` is the anchor; the others
  resolve relative to it (`{base, relative}` specs) so a harness only overrides the single
  root it actually installs into.
  A path entry whose relative path sits under `docs/` names a document the install ships:
  both installers copy it from the package root into the staged tree at that relative path
  (`scripts/lib/docs.mjs`), so a skill can read it on a machine with no checkout. One copy
  per install serves every skill that references it, and the token map decides both the
  location and the shipment — `skill_anatomy` is read by both `write-a-skill` and
  `refactor-skill`. The repo's `docs/` stays the single source of truth; the staged file is
  a verbatim copy, never a second authored version.
  A second shipped doc is declared twice: the `paths` entry sets its install location, and
  `package.json` `files` must list the same path. The test stages from the checkout, so only
  the `files` whitelist catches a doc that the published package omits.
  Claude's `plugin_root` stays the `${CLAUDE_PLUGIN_ROOT}` env-var token, never a literal
  `~/.agent-cortex/claude`: Claude Code **copies** marketplace-installed plugins — including
  local directory sources like `~/.agent-cortex/claude` — into its own cache, so only the
  runtime env var (expanded per context by Claude Code) points at wherever the plugin
  actually runs from. A literal home path in substituted files would break under
  cache-copy, so the installer passes the env form through verbatim.
- **`layouts`** — the tree each installer stages a resource into, for the resources whose
  shape differs per harness. Only `skills` differs: the repository nests every skill one group
  deep (`skills/<group>/<name>/`), and `bin/installers/pi.mjs` preserves that, while Claude
  Code's plugin scan discovers `skills/<name>/SKILL.md` directly under `skills/`, so
  `bin/installers/claude.mjs` copies every skill flat. A `{{PATH:skills/…}}` row is authored
  against the repository tree; resolution reads the harness's row here and drops the group
  segment when the harness stages skills flat, so the row names a file the install contains.
  The row is a harness fact, not a repository one, which is why it lives here rather than in
  the resolver: a harness that stages skills differently changes this table, not the code.
- **`agents`** — the `agent-cortex:` name-prefix convention per harness (claude strips the
  prefix during conversion). Agent names themselves do not get per-row mappings because
  the prefix rule covers all of them — every agent is composed from `agents/<name>/` for
  every harness, so there is no structural exception to record.
- **`wake`** — the completion mechanism per harness (`pi`: blocking-wait,
  `claude`: event-driven). Informational only — no installer substitutes a
  token from it. It records the fact that the shared ralph body deliberately does not
  state, so `{{SECTION:wake}}` → `agents/ralph/<harness>/wake.md` is the single place
  harness specifics live, and the mechanism stays checkable instead of being inferred from
  prose. `agents/README.md` carries the same table for humans.
- **Deliberately not mapped:** hook patterns, MCP servers, and tool descriptions. Those
  differ *structurally* per harness (different hook event names, different config files),
  not by a single substitutable token; each installer already hardcodes its own shape. The
  map records them in `notes` where a tool differs in behaviour (`read_agent`, `skill`,
  `ask_user`).

### 3. Null mappings and command mappings

A null value means **"this harness has no equivalent"** — not "empty string" and not "leave
the token as-is". The contract defines the two contexts:

- **Prose** (e.g. `Use {{CAPABILITY:read_agent}} to poll`): the token is dropped and the
  installer warns. Dangling sentences after a drop are the author's responsibility — the
  warning exists so the installer surfaces them.
- **Tool-list frontmatter** (e.g. `tools: [..., "read_agent"]`): the entry is omitted from
  the array.

A `command` is legal in prose and illegal in a tool list. Prose substitution never consults
the kind: a command is named exactly as a tool is, because prose is the one place a
user-invoked capability can be described to the model. A tool list that resolves to a command
is a **hard error naming the canonical key** — resolving it would enable a name the harness
never offers as a tool, and dropping it silently would hide the same defect an absent tool
hides.

Unknown (unmapped) tokens are a **hard error**, not a null — a silently-passed-through
token is exactly the bug the map exists to prevent, and mirrors the build script's
`unknown capability "x"` throw.

The peer channel is the worked example. `peer_get` and `peer_await` are `pi-peer` tools and
Claude Code has no equivalent, so they get no row and a shared sentence never names them:
substituting one would drop the token and leave the sentence that named it short of a name.
Their documentation stays inside a section labelled for one harness, where nothing is
substituted — see the `pi-peer` runbook in `skills/workflow/ralph/REFERENCE.md`.

`post_merge_watch` is deliberately **not** null on either side: a null would drop the token in the
pi render or the claude render and leave the sentence that named the mechanism short of one. The
fallback for a session that has no watcher is therefore written as prose in the same section, so
it survives both renders unchanged — see `skills/workflow/run-pipeline-stage/playbooks/post-merge.md`.

The pi install-time installer (`bin/installers/pi.mjs`) follows the strict contract above.
One consumer deviates deliberately: the pi `agent-modes` extension reads the map at
**runtime** (not install time) to compose agent prompts from the composable agents
format. For it, an unmapped tool name passes through unchanged — it may be a
native PI tool — while a mapped-null tool is omitted with a warning, and a capability bound
to a `command` is reported and the one agent skipped rather than taking every mode down with
it. The pi column
currently maps every canonical tool (`ask_user` → `ask_questions`, `skill` → `read`),
so the warn-and-omit path applies only to future null entries. See
`extensions/agent-modes/README.md`.

### 4. Token substitution contract

The full contract is embedded in `token-map.json` under `contract`. In summary, installers:

1. Bind a harness id (`claude` | `pi`).
2. Substitute in order: `SECTION` (left for the composer), then `CAPABILITY`, then `PATH`.
3. For `CAPABILITY`: look up the canonical key, replace with the harness name; null → drop/omit;
   a `command` in a tool list → throw; unknown → throw.
4. For `PATH`: named key → resolve from `paths`; anything else → resolve relative to
   `plugin_root`, after mapping a `skills/…` row onto the harness's staged shape from
   `layouts`; `${ENV_VAR}` values pass through verbatim for runtime expansion.
5. Reject a map `version` they do not implement.

## Authoring guidance

- Write tokens with the **canonical authoring names**: `Use {{CAPABILITY:task}} to spawn
  subagents`, `Read {{PATH:skills/workflow/plan/SKILL.md}}`. Write a skill path row in this
  repository's grouped form, `skills/<group>/<name>/<file>`; each install maps it onto the
  shape it stages (see `layouts`), so one authored row names a real file on both harnesses.
- Never embed a harness-specific name in the canonical sources (`agents/<name>/agent.md`,
  `skills/**/SKILL.md`) — that defeats the map. The materialised Claude plugin
  (`~/.agent-cortex/claude`), the generated `agents/*.agent.md` files, and any installed
  copies are the only places substituted names appear.
- When you add a new capability to an agent's frontmatter, add a row to `capabilities` in
  `token-map.json` in the same change — the contract treats unknown capabilities as errors, so a
  missing row breaks the install pipeline loudly instead of silently.

## Related

- `agents/README.md` — composable agent directory format (ADR #63), defines the token
  grammar the map implements.
- `scripts/lib/compose-agent.mjs` — the shared token composer: resolves `{{CAPABILITY:...}}` /
  `{{PATH:...}}` against the map and `{{SECTION:...}}` from the per-harness section files
  for `bin/installers/claude.mjs` and `bin/installers/pi.mjs`.
- `bin/installers/claude.mjs` — the single Claude generator: plain
  `agent-cortex install claude` materialises the plugin into `~/.agent-cortex/claude`
  with token-substituted skills, merges the committed `claude/settings.json` into
  `~/.claude/settings.json`, and registers it with Claude Code; `--output <dir>` is the
  generate-only form (tests/CI structural checks). The only committed `claude/` file is the
  settings template.
- `bin/installers/pi.mjs` — the pi harness installer (`agent-cortex install pi`), an
  install-time consumer of the map's contract.
- `lib/cli.mjs` — `SUPPORTED_HARNESSES`, the install command surface the harness ids come
  from.