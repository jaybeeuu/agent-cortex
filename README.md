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
│       └── claude.mjs        # install-time generator — agent-cortex install claude (pnpm build:claude aliases it)
├── scripts/
│   └── build-copilot-agents.mjs  # thin wrapper over bin/installers/copilot.mjs (regenerates agents/*.agent.md)
└── claude/                   # Self-contained Claude Code plugin (GENERATED — do not hand-edit)
    ├── .claude-plugin/
    │   └── plugin.json
    ├── .mcp.json             #  MCP servers (context7, github) — hand-authored
    ├── hooks.json            #  SessionStart hooks (beads context + style policy) — generated from hooks/claude/
    ├── agents/               #  composed from agents/<name>/claude/ + copied from agents-native/
    └── skills/               #  symlinks to the grouped skills/ dirs (29 skills)
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
The `claude/` subtree is **generated** by the install-time generator
(`bin/installers/claude.mjs`) — `pnpm build:claude` is a pure alias of
`agent-cortex install claude`, so there is no separate build-time code path, and the
committed subtree can never diverge from a real install. CI regenerates it and checks
it is never stale:

- **Skills** stay single-source — `claude/skills/<name>` are symlinks into the grouped
  `skills/<group>/<name>` dirs (Claude discovers skills only one level deep, so the
  grouping is flattened via links, not copies).
- **Agents** can't be shared files (the frontmatter formats differ), so `claude/agents/*.md`
  are composed from the canonical `agents/<name>/` directories' `claude/` harness dirs
  (frontmatter.json + section files), exactly like the Copilot flats are composed from their
  `copilot/` dirs. Claude only loads agents from a plugin's default `agents/` dir, so the plugin
  root is `claude/` — isolating it from the Copilot `.agent.md` files.
- **Claude-native agents** that have no Copilot equivalent live in `agents-native/*.md` and are
  copied verbatim into `claude/agents/`. `ralph` is one: it is reimplemented for Claude around
  background workers + an independent review gate (the Copilot Ralph's `task`/`read_agent`
  poll loop has no Claude equivalent), so it can't be mechanically converted.
- **Manifests** are generated too: `claude/.claude-plugin/plugin.json` (its `version` tracks
  `package.json`, so it never goes stale) and `claude/hooks.json` (copied from the canonical
  `hooks/claude/hooks.json` source). `claude/.mcp.json` and `claude/scripts/` stay hand-authored.

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
changesets are pending, then publishes to npm once it lands — packing with `pnpm
pack` and publishing with `npm publish --provenance --access public`. Releases are
sourced entirely from `main`.

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

The Claude plugin is the self-contained `claude/` subtree (manifest at
`claude/.claude-plugin/plugin.json`), containing **4 agents** (`strategy`, `plan`,
`ralph-plan`, `ralph`), **29 skills**, a `SessionStart` hook, and 2 MCP servers.

`claude/` is committed (the marketplace install flow reads it straight from the working
tree, so a fresh clone installs as-is), and rebuilt via the install-time generator if you
change the sources:

```sh
pnpm build:copilot   # or: node scripts/build-copilot-agents.mjs (regenerates agents/*.agent.md)
pnpm build:claude    # or: node bin/agent-cortex.mjs install claude (same generator)
# or the install-time entry (same generator, less typing):
node bin/agent-cortex.mjs install copilot          # regenerates agents/*.agent.md in place
node bin/agent-cortex.mjs install copilot --dry-run       # plan only, no writes
node bin/agent-cortex.mjs install copilot --output /tmp/x # preview the flat files elsewhere
node bin/agent-cortex.mjs install claude           # regenerates ./claude in place
node bin/agent-cortex.mjs install claude --dry-run       # plan only, no writes
node bin/agent-cortex.mjs install claude --output /tmp/x # write the subtree elsewhere
```

#### Try it for one session

```sh
claude --plugin-dir /path/to/agent-cortex/claude
# verify what loaded:
claude --plugin-dir /path/to/agent-cortex/claude plugin details agent-cortex
```

`SKILL.md` edits are picked up live in that session; agent, hook, and MCP changes need
`/reload-plugins`.

#### Install persistently (recommended)

The repo ships a marketplace manifest (`.claude-plugin/marketplace.json`) that exposes the
`claude/` subtree. Register it by **absolute path** (a bare `.` is rejected — use an absolute
path or a `./`-prefixed one), then install:

```sh
claude plugin marketplace add /path/to/agent-cortex
claude plugin install agent-cortex@jaybeeuu          # every session (user scope)
# or, for this project only:
claude plugin install agent-cortex@jaybeeuu --scope local
```

After installing, the agents and skills are available in every session with no `--plugin-dir`
flag, and Ralph is just `claude --agent agent-cortex:ralph`.

#### Update

The marketplace source is your local checkout, so after pulling changes you must rebuild the
`claude/` subtree and refresh the plugin:

```sh
git pull
pnpm build:claude                          # alias of agent-cortex install claude
claude plugin marketplace update jaybeeuu
claude plugin update agent-cortex          # restart Claude Code to apply
```

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

#### Style-skill enforcement

The plugin's `SessionStart` hook injects a "style policy" each session, nudging Claude to
invoke `style-code` / `style-tests` / `style-documentation` / `style-comms` before the
corresponding work; the style skills' descriptions are also written to auto-trigger proactively.

#### Not ported / follow-ups

- The pi `extensions/` have no Claude runtime-extension equivalent (use hooks/MCP instead).
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
version) — then run `pnpm build:claude` (an alias of `agent-cortex install claude`). Never hand-edit
anything under `claude/` except the hand-authored `claude/.mcp.json` and `claude/scripts/`
files, or the generated `agents/*.agent.md` files, `claude/agents/`, `claude/skills/`,
`claude/.claude-plugin/plugin.json`, and `claude/hooks.json`. CI runs
`git diff --exit-code claude/agents/ claude/skills/ claude/.claude-plugin/plugin.json claude/hooks.json`
and `git diff --exit-code -- 'agents/*.agent.md'` so the generated outputs can never drift.
