# agent-cortex

A personal [GitHub Copilot CLI plugin](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating) containing custom agents and skills.

## Structure

```
agent-cortex/
├── plugin.json           # Plugin manifest
├── agents/               # Custom agents
│   ├── ralph.agent.md
│   ├── ralph-plan.agent.md
│   └── strategy.agent.md
├── skills/               # Skills (grouped by domain)
│   ├── engineering/      #  tdd, improve-codebase-architecture, …
│   ├── planning/         #  write-a-prd, prd-to-tasks, design-an-interface, …
│   ├── productivity/     #  bd-tool, write-a-skill, grill-me, …
│   ├── review/           #  review-security
│   ├── style/            #  style-code, style-tests, style-comms, …
│   └── workflow/         #  ralph, run-pipeline-stage, create-task, …
├── extensions/           # PI extensions (optional)
│   ├── skill-stats/
│   └── notify/
├── pi/                   # Global pi configuration (see below)
│   └── settings.json
└── claude/               # Self-contained Claude Code plugin (generated)
    ├── .claude-plugin/
    │   └── plugin.json
    ├── .mcp.json         #  MCP servers (context7, github)
    ├── hooks.json        #  SessionStart context hook
    ├── agents/           #  *.md generated from agents/*.agent.md (do not edit)
    └── skills/           #  symlinks to the grouped skills/ dirs (do not edit)
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

Edit the sources (`agents/*.agent.md`, `skills/**`), never anything under `claude/`.

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
`claude/.claude-plugin/plugin.json`). Build it from the canonical sources first:

```sh
pnpm build:claude
```

Then load the `claude/` directory for a session:

```sh
claude --plugin-dir /path/to/agent-cortex/claude
```

`SKILL.md` edits are picked up live; agent, hook, and MCP changes need `/reload-plugins`.
For a persistent install, add `claude/` as a local marketplace and
`/plugin install agent-cortex`.

**Not yet ported to Claude:** the `ralph` orchestrator (its `task`+`read_agent`
background-polling has no Claude equivalent and needs a redesign) and the pi `extensions/`
(no Claude runtime-extension API). The `ralph` and `run-pipeline-stage` skills are still
linked in, but their internal orchestration paths only work under the deferred ralph flow.
