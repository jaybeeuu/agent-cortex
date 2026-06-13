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
└── pi/                   # Global pi configuration (see below)
    └── settings.json
```

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
