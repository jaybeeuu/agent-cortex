# agent-nexus

## Install

Run the install script directly from GitHub to add the plugin to both **Copilot CLI** (`~/.copilot`) and **VS Code** user settings:

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/jaybeeuu/agent-nexus/main/install.sh)
```

### What it does

| Target | Action |
|---|---|
| **Copilot CLI** | Runs `copilot plugin install jaybeeuu/agent-nexus` (or `gh copilot -- plugin install …`) to register the plugin in `~/.copilot` |
| **VS Code** | Adds an MCP server entry for `agent-nexus` to your VS Code user `settings.json` |

Restart Copilot CLI / VS Code after running the script.

### Requirements

- **Copilot CLI install** — `copilot` binary or the [GitHub CLI](https://cli.github.com/) (`gh`) must be on your `PATH`
- **VS Code install** — `jq` must be on your `PATH`
