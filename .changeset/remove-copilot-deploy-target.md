---
"@jaybeeuu/agent-cortex": major
---

Remove Copilot CLI as a deploy target. `agent-cortex install copilot` is gone (the
supported harnesses are now `claude` and `pi`), along with the Copilot plugin manifest
`plugin.json`, the `build:copilot` script and its committed `agents/*.agent.md` output,
the `agents/*/copilot/` harness dirs, `scripts/sync-plugin-version.sh`, the `postinstall`
hook and `scripts/install-instructions.sh` that wrote `~/.copilot/copilot-instructions.md`,
and the Copilot column of `token-map.json`.

`version-packages` is now plain `changeset version`: the release surface is
`package.json` + `CHANGELOG.md`, since every plugin is materialised at install time with
the package version. Nothing is swept from an existing `~/.copilot` install — remove
`~/.copilot/installed-plugins/_direct/agent-cortex` by hand.
