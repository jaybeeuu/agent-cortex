---
"@jaybeeuu/agent-cortex": patch
---

Materialise `~/.claude/settings.json` from a new committed `claude/settings.json` template when
`agent-cortex install claude` runs (parity with the pi installer's merge-keep-personal contract).
The template supplies defaults and personal values win; the installer owns exactly
`enabledPlugins` + `extraKnownMarketplaces`, so `permissions`, `hooks`, `env`, `statusLine` and
unknown keys are never touched. A legacy symlinked settings file is replaced with a real file,
`--dry-run` plans without writing, and `--output <dir>` leaves the user's Claude config alone.
