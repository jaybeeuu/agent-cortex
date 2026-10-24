# agent-cortex

A personal collection of custom agents and skills, shipped to three harnesses from one
source: the [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating),
pi, and [Claude Code](https://code.claude.com/docs) (as a plugin).

## Structure

```
agent-cortex/
├── plugin.json               # Copilot plugin manifest
├── agents/                   # Canonical agents — composable <name>/ dirs (see agents/README.md)
│   ├── *.agent.md            #   ralph, ralph-plan, plan, strategy — GENERATED from <name>/ by scripts/build-copilot-agents.mjs
│   ├── ralph/                #   composable form (shared agent.md + per-harness pi/, copilot/, claude/)
│   ├── plan/                 #   "
│   ├── ralph-plan/           #   "
│   └── strategy/             #   "
├── agents-native/            # Claude-only agents with no Copilot equivalent
│   └── ralph.md              #  the lean Claude Ralph
├── skills/                   # Skills (grouped by domain) — shared by all harnesses
│   ├── engineering/          #  tdd, improve-codebase-architecture, …
│   ├── planning/             #  write-a-prd, prd-to-tasks, design-an-interface, …
│   ├── productivity/         #  bd-tool, write-a-skill, grill-me, …
│   ├── review/               #  review-security, refactor-skill, maintain-agent-docs
│   ├── style/                #  style-code, style-tests, style-comms, style-documentation
│   └── workflow/             #  ralph, run-pipeline-stage, create-task, …
├── extensions/               # pi extensions (pi only)
│   ├── agent-guardrails/     #   behavioural circuit-breakers in the system prompt
│   ├── agent-modes/          #   switchable agent modes (reads composable agents/)
│   ├── skill-stats/
│   └── notify/
├── pi/                       # Committed pi config templates (see below)
│   ├── settings.json
│   └── keybindings.json
├── token-map.json            # canonical tool/path/agent names per harness (install-time token substitution)
├── token-map.README.md       # design decisions behind token-map.json
├── bin/
│   ├── agent-cortex.mjs      # CLI entrypoint
│   └── installers/
│       ├── copilot.mjs       # shared generator: agent-cortex install copilot + scripts/build-copilot-agents.mjs
│       └── claude.mjs        # materialises ~/.agent-cortex/claude + ~/.claude/settings.json, registers with Claude Code (--output <dir> = generate-only)
├── scripts/
│   └── build-copilot-agents.mjs  # thin wrapper over bin/installers/copilot.mjs (regenerates agents/*.agent.md)
├── claude/                   # Committed Claude user-settings template (settings.json) — merged into ~/.claude/settings.json
└── claude-extras/            # Hand-authored Claude plugin extras
    ├── .mcp.json             #  MCP servers (context7, github) — copied into installs
    └── scripts/              #  statusline-command.sh — copied into installs (executable)
```

The same `agents/` and `skills/` power three harnesses (Copilot, pi, Claude Code).
The composable `agents/<name>/` directories are the single source of truth; the flat
`agents/*.agent.md` files are **generated** by the shared copilot installer
(`agent-cortex install copilot`, or `scripts/build-copilot-agents.mjs` via
`pnpm build:copilot` — both run the same `bin/installers/copilot.mjs` code path, so
install-time and build-time output can never diverge) and committed so Copilot CLI
(plugin.json `agents: "agents/"`) and pi keep loading the agents — don't hand-edit them.
The `{{TOOL:...}}` / `{{PATH:...}}` tokens written in agent and skill files are resolved
per harness at install time from `token-map.json`, the single source of truth for
canonical tool/path/agent names (see `token-map.README.md` and the `contract` section).
The Claude plugin is **materialised** at install time by `bin/installers/claude.mjs`. A
plain `agent-cortex install claude` copies the plugin into the home install root
(`~/.agent-cortex/claude`), writes a marketplace manifest at
`~/.agent-cortex/.claude-plugin/marketplace.json` exposing it, and registers it with
Claude Code by driving the `claude plugin` CLI — state-checked and idempotent (a fresh
install adds the marketplace + installs the plugin; a re-run updates what state says is
out of date; a repeat install at the same version is a no-op; a missing or pre-v2 CLI
warns and prints the manual registration commands instead of failing). The generated
`claude/` plugin subtree is never committed (only the `claude/settings.json` template and
the hand-authored `claude-extras/` are), so CI validates the materialiser itself — a
temp-dir install plus structural checks:

- **Skills** stay single-source — the installer copies each `skills/<group>/<name>/` dir
  flat into `skills/<name>/` (Claude discovers skills only one level deep) with
  `{{TOOL:...}}` / `{{PATH:...}}` tokens substituted against token-map.json's claude
  column — no symlinks, so literal tokens never reach Claude.
- **Agents** can't be shared files (the frontmatter formats differ), so the materialised
  plugin's `agents/*.md` are composed from the canonical `agents/<name>/` directories' `claude/`
  harness dirs
  (frontmatter.json + section files), exactly like the Copilot flats are composed from their
  `copilot/` dirs. Claude only loads agents from a plugin's default `agents/` dir, so the plugin
  ships them at its own root (default `~/.agent-cortex/claude/agents/`) — isolating them from the
  Copilot `.agent.md` files.
- **Claude-native agents** that have no Copilot equivalent live in `agents-native/*.md` and are
  copied verbatim into the materialised plugin's `agents/`. `ralph` is one: it is reimplemented
  for Claude around
  background workers + an independent review gate (the Copilot Ralph's `task`/`read_agent`
  poll loop has no Claude equivalent), so it can't be mechanically converted.
- **Manifests** are generated too: the plugin's `.claude-plugin/plugin.json` (its `version`
  tracks `package.json`, so it never goes stale) and `hooks.json` (copied from the canonical
  `hooks/claude/hooks.json` source), plus any support files under `hooks/claude/` bundled into
  the plugin's `hooks/` so hook commands can reach them via `$CLAUDE_PLUGIN_ROOT`. Hand-authored
  extras — `.mcp.json` and `scripts/` — are copied into every install from the `claude-extras/`
  dir, which is their canonical store. See `docs/claude-hooks.md` for the
  extension→hook mapping and the rejections (auto-name, agent-guardrails, skill-stats, subagent, agent-modes).

Edit the sources (`agents/<name>/` composable dirs, `agents-native/*.md`, `skills/**`,
`hooks/claude/`, `claude-extras/`, `package.json`), never the generated
`agents/*.agent.md` files or anything under the materialised `~/.agent-cortex/claude`.

## CI

The CI pipeline runs lint, test, and claude-plugin-check as three parallel jobs
(`lint`, `test`, `claude-plugin-check`), each gated on `needs: setup`. Each job
does its own checkout and `pnpm install` rather than sharing build artifacts from
the `setup` job — pnpm workspace symlinks don't survive artifact upload/download,
so artifact sharing would break the workspace resolution that the build depends on.

The repo commits no generated `claude/` plugin output, so the `claude-plugin-check` job
validates the Claude plugin **materialiser** instead of diffing a committed mirror:
it runs `node bin/agent-cortex.mjs install claude --output <tmp dir>` and checks the
result structurally — `plugin.json` version tracks `package.json`, every generated and
hand-authored piece is present, no literal `{{TOOL:...}}`/`{{PATH:...}}` tokens survive,
and no symlinks leak into the copied tree. The Copilot drift check
(`pnpm build:copilot` + `git diff --exit-code -- 'agents/*.agent.md'`) still guards the
committed flat agent files.

A separate `changeset-check` job runs only on pull requests and fails any PR that
touches a versioned path (`extensions/`, `skills/`, `agents/`, `package.json`, or
`plugin.json`) without a changeset in `.changeset/`. Add one with `pnpm changeset` —
the `style-versioning` skill documents the format.

On pushes to `main`, a `release` job (gated on `lint`, `test`, and
`claude-plugin-check`) runs changesets to open a `chore: version packages` PR when
changesets are pending, then publishes to npm once it lands. The version step runs
`pnpm version-packages` — bumping `package.json`, syncing `plugin.json`, and
regenerating the committed Copilot agent files (the Claude plugin is materialised at
install time with the package version, so it has no committed output to regenerate)
so the drift gates stay green; the
publish step runs `pnpm publish-package` (pack + provenance publish). Publish
authenticates via npm Trusted Publishing (OIDC) — no npm token or GitHub
secret is needed, only the one-time npm-side setup on npmjs.com (package →
Access → Trusted Publishing for the `jaybeeuu/agent-cortex` repo). Releases
are sourced entirely from `main`.

## Installation

### Pi package staging (`agent-cortex install pi`)

`agent-cortex install pi` materialises agent-cortex as a self-contained pi
package in `~/.agent-cortex/pi` — the pi analogue of `~/.agent-cortex/claude`.
Nothing is written into pi's own directories (`~/.pi/agent/…`); registering the
package with pi is a separate step.

```sh
agent-cortex install pi
pi install ~/.agent-cortex/pi     # register the staged package with pi
```

The staged package contains:

| Path | Contents |
| `package.json` | pi manifest — `keywords: ["pi-package"]`, `pi.extensions` + `pi.skills`; the version tracks the package |
| `agents/` | composed flat agents (ralph, plan, ralph-plan, strategy) with `{{TOOL:...}}` / `{{PATH:...}}` substituted — the shipped `agent-modes` extension resolves them from the package root |
| `skills/` | token-substituted skill copies (real files, never symlinks) |
| `extensions/` | copy of the repo `extensions/` tree |
| `token-map.json` | the token map `agent-modes` reads from the package root |
| `node_modules/` | the required third-party pi packages and their transitive closure |

The third-party packages supply the tools the agents need — `pi-questions`
(`ask_questions`) and `pi-web-access` (`fetch_content`). They are ordinary
runtime dependencies of this package and travel inside the staged tree, so pi
loads them from a local directory without any npm resolution of its own. An
unresolvable dependency fails the install rather than staging a package that
cannot provide those tools. Re-staging clears the children the installer owns, so
a re-run never accumulates stale copies.

| Flag | Meaning |
| `--dry-run` | Show what would be staged without writing anything |
| `--output <dir>` | Stage into `<dir>` instead of `~/.agent-cortex/pi` (tests/CI) |
| `--plugin-root <dir>` | Override the plugin root used for `{{PATH:...}}` tokens (default: token-map.json's pi value — use it for checkout or symlinked installs) |

Re-run whenever you pull changes, then re-register.

### Desktop notifications

Desktop notifications are handled by the local `extensions/notify/` extension
(replaces the former `pi-notify` dependency). It sends an OSC desktop
notification on multi-turn tasks, labelled with the tmux session:window.pane
if available, or the project directory name otherwise.

### Pi config files

`pi/settings.json` and `pi/keybindings.json` are committed **reference
templates** for your own pi configuration. They are not installer output: pi's
`settings.json` and `keybindings.json` are pi's own user config, so
`agent-cortex install pi` leaves them alone.

### Copilot plugin (separate)

```sh
copilot plugin install jaybeeuu/agent-cortex
```

Or install a local checkout:

```sh
copilot plugin install ./agent-cortex
```

### Claude Code plugin (separate)

A plain `agent-cortex install claude` **materialises** the plugin into the home install
root `~/.agent-cortex/claude` — **4 agents** (`strategy`, `plan`, `ralph-plan`, `ralph`),
**29 skills** (copied flat per skill, `{{TOOL:...}}` / `{{PATH:...}}` token-substituted — no
symlinks), `SessionStart` + `Notification` hooks, and 2 MCP servers — writes a marketplace
manifest at `~/.agent-cortex/.claude-plugin/marketplace.json` exposing `./claude`, and
registers it with Claude Code, and merges the committed `claude/settings.json` template into
`~/.claude/settings.json`: the template supplies defaults, personal values win, and the
installer owns exactly `enabledPlugins` + `extraKnownMarketplaces` — every other key
(`permissions`, `hooks`, `env`, `statusLine`, unknown keys) is preserved. The only committed
Claude config is that template plus the hand-authored extras in `claude-extras/`
(`.mcp.json`, `scripts/`); the plugin subtree is generated at install time — there is nothing
to drift.

The generate-only `--output <dir>` form is for previewing and CI validation; the
documented path is the plain install to `~/.agent-cortex/claude`:

```sh
pnpm build:copilot   # or: node scripts/build-copilot-agents.mjs (regenerates agents/*.agent.md)
node bin/agent-cortex.mjs install copilot          # regenerates agents/*.agent.md in place
node bin/agent-cortex.mjs install copilot --dry-run       # plan only, no writes
node bin/agent-cortex.mjs install copilot --output /tmp/x # preview the flat files elsewhere
node bin/agent-cortex.mjs install claude           # materialises ~/.agent-cortex/claude + marketplace manifest AND registers it with Claude Code (user scope, idempotent)
node bin/agent-cortex.mjs install claude --dry-run       # plan generation + registration, no writes/spawns
node bin/agent-cortex.mjs install claude --require-register  # fail (non-zero exit) when the claude CLI can't drive registration
node bin/agent-cortex.mjs install claude --output /tmp/x # generate only (preview/CI) — no marketplace manifest, no registration
```

#### Try it for one session

Generate a throwaway plugin and point Claude Code at it — no install or registration
needed:

```sh
node bin/agent-cortex.mjs install claude --output /tmp/agent-cortex-claude
claude --plugin-dir /tmp/agent-cortex-claude
# verify what loaded:
claude --plugin-dir /tmp/agent-cortex-claude plugin details agent-cortex
```

`SKILL.md` edits are picked up live in that session; agent, hook, and MCP changes need
`/reload-plugins`.

#### Install persistently (recommended)

The plain install does both halves in one step: it materialises the plugin into
`~/.agent-cortex/claude`, writes `~/.agent-cortex/.claude-plugin/marketplace.json` (the
home install root doubles as the marketplace root — the manifest exposes `./claude`), and
registers it with Claude Code by driving the `claude plugin` CLI against that root at
**user scope** (the `claude plugin install` default, so the plugin is available in every
session — the recommended persistent flow). Registration is idempotent by state, not by
exit code: `claude plugin marketplace list --json` picks add-vs-update and
`claude plugin list --json` picks install-vs-update against the materialised version. A
fresh install adds the marketplace and installs the plugin; a re-run is the update path
(`marketplace update`, plus `plugin update` only when a newer version is materialised); a
repeat install at the same version is a true no-op. It requires the `claude` plugin CLI
(Claude Code v2+): with a missing or pre-v2 CLI the installer warns and prints the manual
commands below, exiting 0 — `--require-register` makes registration mandatory and fails
non-zero when it can't run:

```sh
agent-cortex install claude                          # materialise + register (user scope, idempotent)
agent-cortex install claude --require-register       # register or fail the install
```

`--dry-run` prints the full plan without spawning the claude CLI or writing anything;
`--output <dir>` generates only, with no marketplace manifest and no registration.

The install also merges the committed `claude/settings.json` template into
`~/.claude/settings.json` (the settings file Claude Code reads at user scope). The template
supplies defaults and personal values win; the installer owns exactly `enabledPlugins` +
`extraKnownMarketplaces`, so `permissions`, `hooks`, `env`, `statusLine` and unknown keys are
never touched. A legacy symlinked `settings.json` is replaced with a real file rather than
written through, and `--output` leaves the user's Claude config alone.

The equivalent manual registration adds a marketplace root by **absolute path** (a bare `.` is
rejected) — the home install root (`~/.agent-cortex`) is the marketplace root written by
the plain install; the repo checkout ships no manifest:

```sh
claude plugin marketplace add ~/.agent-cortex              # after a plain install
claude plugin install agent-cortex@jaybeeuu          # every session (user scope)
# or, for this project only:
claude plugin install agent-cortex@jaybeeuu --scope local
```

After installing, the agents and skills are available in every session with no `--plugin-dir`
flag, and Ralph is just `claude --agent agent-cortex:ralph`.

#### Update

The plain install re-materialises from the current sources, so after pulling changes
re-run it — it refreshes the materialised plugin and re-registers whatever the installed
state says is out of date (`marketplace update`, plus `plugin update` only when a newer
version is materialised; a repeat install at the same version is a no-op) in one step:

```sh
git pull
agent-cortex install claude                # re-materialise + refresh (restart Claude Code to apply)
```

Registration matches the marketplace by **name**, not path: a marketplace previously added
from a different root is refreshed in place rather than re-pointed at the fresh home
install. Re-point it with
`claude plugin marketplace remove jaybeeuu` and re-run the install.

The plain install IS the update — there is no separate build step. (`--output <dir>` only
generates a preview and never refreshes an installed plugin.)

#### Uninstall

```sh
claude plugin uninstall agent-cortex
claude plugin marketplace remove jaybeeuu
```

#### Using the agents

| Agent | How to invoke | Purpose |
|---|---|---|
| `strategy` | delegate: "use the **strategy** agent…" | Vision brief / PRD / technical-direction docs |
| `ralph-plan` | delegate: "use the **ralph-plan** agent…" | Explore, grill, and file beads for a change |
| `plan` | delegate: "use the **plan** agent…" | End-to-end planning (PRD → classified beads) |
| `ralph` | **run as the main agent**: `claude --agent agent-cortex:ralph` | Parallel backlog orchestrator (below) |

Skills auto-trigger from their descriptions, or invoke one explicitly as
`/agent-cortex:<skill>` (e.g. `/agent-cortex:tdd`).

The lean **Ralph** runs as the interactive main agent (not delegated — it must stay alive to
receive its workers' completions):

```sh
claude --agent agent-cortex:ralph        # (omitted once installed via agent-cortex install claude; else --plugin-dir ~/.agent-cortex/claude)
```

It finds ready beads, spawns parallel background workers (implement → independent review →
fix), opens a PR per feature, and pauses at each human merge gate. After you merge, re-invoke
it and it resumes from `bd ready`.

#### Hooks

`SessionStart` injects a per-session policy nudging Claude to prefer the shipped skills over
ad-hoc choices: the "style policy" (invoke `style-code` / `style-tests` /
`style-documentation` / `style-comms` before the corresponding work — their descriptions also
auto-trigger proactively) and the "skill policy" (`using-agent-skills` for routing, `bd-tool`
for beads context, `git-workflow` for branch/PR discipline). A `Notification` hook matched on
`agent_completed|agent_needs_input|permission_prompt` raises a desktop notification when a
task finishes, waits on input, or needs approval. See `docs/claude-hooks.md` for the full
extension→hook audit.

#### Not ported / follow-ups

- Only `session-start` and `notify` had Claude equivalents (both ported to hooks); the other
  pi `extensions/` (auto-name, agent-guardrails, skill-stats, subagent, agent-modes) have none — the audit and
  rejection rationale live in `docs/claude-hooks.md`.
- Ralph follow-ups: multi-feature epic branches, and a GitHub-trigger routine to auto-resume
  after a PR merge (instead of manual re-invocation).
- The Copilot/pi Ralph (the 4-stage `run-pipeline-stage` pipeline) is unchanged; those two
  ralph-coupled skills (`ralph`, `run-pipeline-stage`) are intentionally not shipped to Claude.

#### Contributing to the Claude plugin

Edit the **sources** — the composable `agents/<name>/` directories (shared `agent.md` +
per-harness frontmatter/sections, auto-composed by `scripts/build-copilot-agents.mjs` and
`bin/installers/claude.mjs`), `agents-native/*.md` (Claude-only
agents like `ralph` — the canonical bodies the installer copies verbatim), `skills/**`,
`hooks/claude/hooks.json` (hook config), `claude/settings.json` (the user-settings template
merged into `~/.claude/settings.json`), `claude-extras/` (hand-authored `.mcp.json` and
`scripts/`), and `package.json` (plugin
version — picked up at install time) — then run
`agent-cortex install claude` (re-materialises the home plugin, merges settings, and
re-registers it; `--output <dir>` generates a preview only). The only committed file under
`claude/` is the settings template; `~/.agent-cortex/claude` is generated in full
(`.claude-plugin/plugin.json`, `agents/`, `skills/`, `hooks.json`, `.mcp.json`, `scripts/`)
so never edit anything under it. The generated `agents/*.agent.md` files are still
drift-checked by CI (`git diff --exit-code -- 'agents/*.agent.md'`), and CI validates the
Claude materialiser (structural checks on a temp-dir install) so sources and installer can
never silently diverge.
