# agent-cortex

A personal [GitHub Copilot CLI plugin](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating) and [PI Agent](https://github.com/earendil-works/pi) package with custom agents, skills, and a subagent pipeline extension.

## Structure

```
agent-cortex/
├── package.json            # PI package manifest (pi key: extensions, skills, stageConfig, agents)
├── plugin.json             # Copilot CLI plugin manifest
├── agents/                 # Custom agents (*.agent.md)
│   ├── ralph.agent.md
│   ├── ralph-plan.agent.md
│   └── strategy.agent.md
├── skills/                 # Skills (one directory per skill, each with a SKILL.md)
│   ├── ralph/              # Fleet orchestrator — runs beads through pipeline stages
│   ├── run-beads/          # Pipeline stage config (stages.json) and playbooks
│   ├── create-task/        # Task creation and pipeline config
│   ├── style-code/         # Coding conventions
│   ├── style-tests/        # Test conventions
│   ├── ...                 # 20+ skills
│   └── write-a-ticket/
└── pi/
    └── extensions/
        └── subagent/       # Subagent tool extension (registers the `subagent` tool)
            ├── index.ts    # Extension entry point — registers tool with PI
            ├── runner.ts   # Subprocess spawning and output parsing
            ├── agents.ts   # Agent discovery and stage config loading
            ├── utils.ts    # Pure utility functions
            └── test.ts     # Tests for the extension
```

## Installation

### PI Agent

```sh
# From a local checkout
pi install .

# Or from GitHub
pi install jaybeeuu/agent-cortex
```

### Copilot CLI

```sh
gh copilot plugin install jaybeeuu/agent-cortex
```

Or install a local checkout:

```sh
gh copilot plugin install ./agent-cortex
```

## Usage

### PI Agent

Once installed, PI discovers:
- **Agents**: `ralph`, `ralph-plan`, `strategy` — available as user-facing agents
- **Skills**: all skills under `skills/` — usable via `/skill` commands
- **Subagent tool**: the `subagent` tool is registered for pipeline stage dispatch in `ralph` and `run-beads`

Run the fleet orchestrator:

```
/ralph  Process all ready beads through their pipeline stages
```

### Copilot CLI

Agents are available through Copilot CLI as configured in `plugin.json`:

```sh
gh copilot ralph
gh copilot ralph-plan
gh copilot strategy
```

## Pipeline

The `ralph` orchestrator dispatches work through pipeline stages using the `subagent` tool. Each stage runs in an isolated PI subprocess with a stage-appropriate model and restricted tool set. Stages are configured in `skills/run-beads/stages.json`.

| Stage | Model | Tools | Description |
|-------|-------|-------|-------------|
| coding | big-pickle | read, bash, edit, write, grep, find, ls | TDD vertical slices |
| test-writing | mimo-v2.5-free | read, bash, edit, write, grep, find, ls | Write tests |
| test-reviewing | deepseek-v4-flash-free | read, bash, grep, find, ls | Evaluate tests |
| reviewing | deepseek-v4-flash-free | read, bash, grep, find, ls | Security & code review |
| fixing | big-pickle | read, bash, edit, write, grep, find, ls | Fix review issues |
| verifying | deepseek-v4-flash-free | read, bash, grep, find, ls | Run tests/lint |
| documenting | mimo-v2.5-free | read, bash, edit, write, grep, find, ls | Update docs |

## Development

### Prerequisites

- Node.js >= 22
- pnpm (for Copilot CLI plugin)
- PI Agent (for PI package)

### PI Extension

The `subagent` extension lives in `pi/extensions/subagent/`. Run tests:

```sh
cd pi/extensions/subagent
pnpm test
```

The extension is auto-discovered by PI when installed via `pi install .`.
