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
├── agents/                   # Canonical agents (Copilot/pi format: *.agent.md)
│   ├── ralph.agent.md
│   ├── ralph-plan.agent.md
│   ├── plan.agent.md
│   └── strategy.agent.md
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
│   ├── skill-stats/
│   └── notify/
├── pi/                       # Global pi configuration (see below)
│   └── settings.json
├── scripts/
│   └── build-claude-agents.mjs   # builds the claude/ subtree from the sources above
└── claude/                   # Self-contained Claude Code plugin (GENERATED — do not hand-edit)
    ├── .claude-plugin/
    │   └── plugin.json
    ├── .mcp.json             #  MCP servers (context7, github)
    ├── hooks.json            #  SessionStart hooks (beads context + style policy)
    ├── agents/               #  generated from agents/*.agent.md + copied from agents-native/
    └── skills/               #  symlinks to the grouped skills/ dirs (28 skills)
```

The same `agents/` and `skills/` power three harnesses (Copilot, pi, Claude Code).
The `claude/` subtree is **generated** by `scripts/build-claude-agents.mjs`
(`pnpm build:claude`) and committed; CI checks it is never stale:

- **Skills** stay single-source — `claude/skills/<name>` are symlinks into the grouped
  `skills/<group>/<name>` dirs (Claude discovers skills only one level deep, so the
  grouping is flattened via links, not copies).
- **Agents** can't be shared files (the frontmatter formats differ), so `claude/agents/*.md`
  are converted from the canonical `agents/*.agent.md`. Claude only loads agents from a
  plugin's default `agents/` dir, so the plugin root is `claude/` — isolating it from the
  Copilot `.agent.md` files.
- **Claude-native agents** that have no Copilot equivalent live in `agents-native/*.md` and are
  copied verbatim into `claude/agents/`. `ralph` is one: it is reimplemented for Claude around
  background workers + an independent review gate (the Copilot Ralph's `task`/`read_agent`
  poll loop has no Claude equivalent), so it can't be mechanically converted.

Edit the sources (`agents/*.agent.md`, `agents-native/*.md`, `skills/**`), never anything
under `claude/`.

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
`ralph-plan`, `ralph`), **28 skills**, a `SessionStart` hook, and 2 MCP servers.

`claude/` is committed, so a fresh clone is installable as-is. If you change the sources,
rebuild it (the generator is a zero-dependency Node script):

```sh
pnpm build:claude    # or: node scripts/build-claude-agents.mjs
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
pnpm build:claude                          # regenerate claude/ from the sources
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

Edit the **sources** — `agents/*.agent.md` (Copilot format, auto-converted),
`agents-native/*.md` (Claude-only agents like `ralph`), and `skills/**` — then run
`pnpm build:claude`. Never hand-edit anything under `claude/` (except the hand-authored
`claude/hooks.json`, `claude/.mcp.json`, and `claude/.claude-plugin/plugin.json`). CI runs
`git diff --exit-code claude/agents/ claude/skills/` so the generated tree can never drift.
