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
└── extensions/           # PI extensions (optional)
    └── skill-stats/
```

## Installation

```sh
copilot plugin install jaybeeuu/agent-cortex
```

Or install a local checkout:

```sh
copilot plugin install ./agent-cortex
```
