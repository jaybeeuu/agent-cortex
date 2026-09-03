# agent-cortex

A personal collection of custom agents and skills, shipped to three harnesses from one
source: the [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating),
pi, and [Claude Code](https://code.claude.com/docs) (as a plugin).

## Structure

```
agent-cortex/
├── plugin.json               # Copilot plugin manifest
├── .claude-plugin/
│   └── marketplace.json      # Claude marketplace (exposes ./claude as the "jaybeeuu" market)
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
│   ├── agent-modes/          #   switchable agent modes (reads composable agents/)
│   ├── skill-stats/
│   └── notify/
├── pi/                       # Global pi configuration (see below)
│   └── settings.json
├── token-map.json            # canonical tool/path/agent names per harness (install-time token substitution)
├── token-map.README.md       # design decisions behind token-map.json
├── bin/
│   ├── agent-cortex.mjs      # CLI entrypoint
│   └── installers/
│       ├── copilot.mjs       # shared generator: agent-cortex install copilot + scripts/build-copilot-agents.mjs
│       └── claude.mjs        # materialises ~/.agent-cortex/claude + registers with Claude Code (pnpm build:claude = generate-only --output form)
├── scripts/
│   └── build-copilot-agents.mjs  # thin wrapper over bin/installers/copilot.mjs (regenerates agents/*.agent.md)
└── claude/                   # Committed plugin mirror — canonical store for hand-authored extras; regenerated via pnpm build:claude (a plain install materialises ~/.agent-cortex/claude instead)
    ├── .claude-plugin/
    │   └── plugin.json
    ├── .mcp.json             #  MCP servers (context7, github) — hand-authored (copied into installs)
    ├── hooks.json            #  SessionStart + Notification hooks — generated from hooks/claude/
    ├── hooks/                #  hook scripts (e.g. scripts/notify.mjs) — generated from hooks/claude/
    ├── agents/               #  composed from agents/<name>/claude/ + copied from agents-native/
    └── skills/               #  flat copies of skills/<group>/<name>/ (29 skills, token-substituted)
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
warns and prints the manual registration commands instead of failing). `pnpm build:claude`
is the pure, generate-only alias — it passes
`--output claude`, so CI and release drift-checks never spawn the claude CLI or touch
`~/.agent-cortex`. CI regenerates the committed mirror and checks it is never stale:

- **Skills** stay single-source — the installer copies each `skills/<group>/<name>/` dir
  flat into `skills/<name>/` (Claude discovers skills only one level deep) with
  `{{TOOL:...}}` / `{{PATH:...}}` tokens substituted against token-map.json's claude
  column — no symlinks, so literal tokens never reach Claude.
- **Agents** can't be shared files (the frontmatter formats differ), so `claude/agents/*.md`
  are composed from the canonical `agents/<name>/` directories' `claude/` harness dirs
  (frontmatter.json + section files), exactly like the Copilot flats are composed from their
  `copilot/` dirs. Claude only loads agents from a plugin's default `agents/` dir, so the plugin
  root is `claude/` — isolating it from the Copilot `.agent.md` files.
- **Claude-native agents** that have no Copilot equivalent live in `agents-native/*.md` and are
  copied verbatim into `claude/agents/`. `ralph` is one: it is reimplemented for Claude around
  background workers + an independent review gate (the Copilot Ralph's `task`/`read_agent`
  poll loop has no Claude equivalent), so it can't be mechanically converted.
- **Manifests** are generated too: the plugin's `.claude-plugin/plugin.json` (its `version`
  tracks `package.json`, so it never goes stale) and `hooks.json` (copied from the canonical
  `hooks/claude/hooks.json` source), plus any support files under `hooks/claude/` bundled into
  the plugin's `hooks/` so hook commands can reach them via `$CLAUDE_PLUGIN_ROOT`. Hand-authored
  extras — `.mcp.json` and `scripts/` — are copied into every install from the committed
  `claude/` subtree, which stays their canonical store. See `docs/claude-hooks.md` for the
  extension→hook mapping and the rejections (auto-name, skill-stats, subagent, agent-modes).

Edit the sources (`agents/<name>/` composable dirs, `agents-native/*.md`, `skills/**`,
`hooks/claude/`, `package.json`), never anything under `claude/` or the generated
`agents/*.agent.md` files.

## CI

The CI pipeline runs lint, test, and claude-plugin-check as three parallel jobs
(`lint`, `test`, `claude-plugin-check`), each gated on `needs: setup`. Each job
does its own checkout and `pnpm install` rather than sharing build artifacts from
the `setup` job — pnpm workspace symlinks don't survive artifact upload/download,
so artifact sharing would break the workspace resolution that the build depends on.

A separate `changeset-check` job runs only on pull requests and fails any PR that
touches a versioned path (`extensions/`, `skills/`, `agents/`, `package.json`, or
`plugin.json`) without a changeset in `.changeset/`. Add one with `pnpm changeset` —
the `style-versioning` skill documents the format.

On pushes to `main`, a `release` job (gated on `lint`, `test`, and
`claude-plugin-check`) runs changesets to open a `chore: version packages` PR when
changesets are pending, then publishes to npm once it lands. The version step runs
`pnpm version-packages` — bumping `package.json`, syncing `plugin.json`, and
regenerating the committed generated output so the drift gates stay green; the
publish step runs `pnpm publish-package` (pack + provenance publish). Publish
authenticates via npm Trusted Publishing (OIDC) — no npm token or GitHub
secret is needed, only the one-time npm-side setup on npmjs.com (package →
Access → Trusted Publishing for the `jaybeeuu/agent-cortex` repo). Releases
are sourced entirely from `main`.

## Installation

### Symlink as global pi config

This repo's `pi/settings.json` is symlinked to `~/.pi/agent/settings.json`,
making it the canonical store for personal pi agent configuration:

```sh
~/.pi/agent/settings.json -> /path/to/agent-cortex/pi/settings.json
```

All `pi install` / `pi remove` commands write to this file, and changes are
committed to git. On a fresh machine:

```sh
git clone https://github.com/jaybeeuu/agent-cortex
ln -sf "$PWD/agent-cortex/pi/settings.json" ~/.pi/agent/settings.json
```

### Pi package dependencies

These packages are declared in `pi/settings.json` and auto-installed by pi:

| Package | Version | Purpose |
|---|---|---|
| [`pi-web-access`](https://www.npmjs.com/package/pi-web-access) | 0.10.7 | Web search, URL fetching, GitHub repo access, PDF/YouTube/video analysis |

Desktop notifications are handled by the local `extensions/notify/` extension
(replaces the former `pi-notify` dependency). It sends an OSC desktop
notification on multi-turn tasks, labelled with the tmux session:window.pane
if available, or the project directory name otherwise.

### Pi harness agents & skills (`agent-cortex install pi`)

The agents are already available to pi through the package (`pi.skills` + the
`agent-modes` extension compose them at runtime), but the raw package files carry
literal `{{TOOL:...}}` / `{{PATH:...}}` tokens. Run the pi installer to materialise
composed agents and token-substituted skills into pi's user scope:

```sh
agent-cortex install pi
# → ~/.pi/agent/agents/<name>.agent.md (ralph, plan, ralph-plan, strategy)
# → ~/.pi/agent/skills/  (token-substituted skill tree)
```

Flags:

| Flag | Meaning |
| --- | --- |
| `--dry-run` | Show what would be installed without writing anything |
| `--output <dir>` | Install into `<dir>/agents` and `<dir>/skills` (default `~/.pi/agent`) |
| `--plugin-root <dir>` | Override the plugin root used for `{{PATH:...}}` tokens (default: token-map.json's pi value — use it for checkout or symlinked installs) |

Re-run whenever you pull changes (`git pull` + reinstall, or after `pnpm build:copilot`).

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
registers it with Claude Code. The committed `claude/` subtree remains the generate-only
mirror: rebuilt via `pnpm build:claude` (i.e. `install claude --output claude`) for the CI
drift gate, and the canonical store for hand-authored extras (`.mcp.json`, `scripts/`), which
every install copies.

Generate or re-generate from source:

```sh
pnpm build:copilot   # or: node scripts/build-copilot-agents.mjs (regenerates agents/*.agent.md)
pnpm build:claude    # or: node bin/agent-cortex.mjs install claude --output claude (generates ./claude only)
# or the install-time entry (same generator, less typing):
node bin/agent-cortex.mjs install copilot          # regenerates agents/*.agent.md in place
node bin/agent-cortex.mjs install copilot --dry-run       # plan only, no writes
node bin/agent-cortex.mjs install copilot --output /tmp/x # preview the flat files elsewhere
node bin/agent-cortex.mjs install claude           # materialises ~/.agent-cortex/claude + marketplace manifest AND registers it with Claude Code (user scope, idempotent)
node bin/agent-cortex.mjs install claude --dry-run       # plan generation + registration, no writes/spawns
node bin/agent-cortex.mjs install claude --require-register  # fail (non-zero exit) when the claude CLI can't drive registration
node bin/agent-cortex.mjs install claude --output /tmp/x # generate only — no marketplace manifest, no registration
# note: the plain claude install writes ~/.agent-cortex; only --output regenerates the committed ./claude mirror
```

#### Try it for one session

This loads the committed `claude/` mirror directly — no install needed.

```sh
claude --plugin-dir /path/to/agent-cortex/claude
# verify what loaded:
claude --plugin-dir /path/to/agent-cortex/claude plugin details agent-cortex
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
`--output <dir>` generates only, with no marketplace manifest and no registration. The
equivalent manual registration adds a marketplace root by **absolute path** (a bare `.` is
rejected) — the repo checkout works too, since it ships the same manifest exposing
`./claude`:

```sh
claude plugin marketplace add /path/to/agent-cortex   # or ~/.agent-cortex after a plain install
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
from a different root (e.g. a repo checkout via the manual flow) is refreshed in place
rather than re-pointed at the fresh home install. Re-point it with
`claude plugin marketplace remove jaybeeuu` and re-run the install.

`pnpm build:claude` only regenerates the committed `claude/` mirror (no registration, no
home install), so on its own it won't refresh an installed plugin.

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
claude --agent agent-cortex:ralph        # (add --plugin-dir .../claude if not installed)
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
  pi `extensions/` (auto-name, skill-stats, subagent, agent-modes) have none — the audit and
  rejection rationale live in `docs/claude-hooks.md`.
- Ralph follow-ups: multi-feature epic branches, and a GitHub-trigger routine to auto-resume
  after a PR merge (instead of manual re-invocation).
- The Copilot/pi Ralph (the 4-stage `run-pipeline-stage` pipeline) is unchanged; those two
  ralph-coupled skills (`ralph`, `run-pipeline-stage`) are intentionally not shipped to Claude.

#### Contributing to the Claude plugin

Edit the **sources** — the composable `agents/<name>/` directories (shared `agent.md` +
per-harness frontmatter/sections, auto-composed by `scripts/build-copilot-agents.mjs` and
the install-time generator `bin/installers/claude.mjs`), `agents-native/*.md` (Claude-only
agents like `ralph` — the canonical bodies the installer copies verbatim), `skills/**`,
`hooks/claude/hooks.json` (hook config), and `package.json` (plugin
version) — then run `pnpm build:claude` (the generate-only alias of `agent-cortex install
claude --output claude`; run the plain install instead if you also want the plugin
re-registered with Claude Code). Never hand-edit
anything under `claude/` except the hand-authored `claude/.mcp.json` and `claude/scripts/`
files, or the generated `agents/*.agent.md` files, `claude/agents/`, `claude/skills/`,
`claude/.claude-plugin/plugin.json`, and `claude/hooks.json`. CI runs
`git diff --exit-code claude/agents/ claude/skills/ claude/.claude-plugin/plugin.json claude/hooks.json`
and `git diff --exit-code -- 'agents/*.agent.md'` so the generated outputs can never drift.
