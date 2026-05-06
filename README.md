# agent-cortex

A personal [GitHub Copilot CLI plugin](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating) containing custom agents and skills.

## Structure

```
agent-cortex/
├── plugin.json           # Plugin manifest
├── agents/               # Custom agents
│   └── nexus.agent.md
└── skills/               # Skills
    └── example/
        └── SKILL.md
```

## Installation

```sh
copilot plugin install jaybeeuu/agent-cortex
```

Or install a local checkout:

```sh
copilot plugin install ./agent-cortex
```
