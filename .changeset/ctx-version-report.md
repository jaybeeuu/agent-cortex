---
"@jaybeeuu/agent-cortex": minor
---

`ctx version` now reports the installed harness versions beside the running CLI version: one line per installed harness read from the fingerprint its installer wrote (`~/.agent-cortex/pi/package.json`, `~/.agent-cortex/claude/.claude-plugin/plugin.json`), marked `current`, `stale`, `ahead` when the installed copy is newer, or `unknown` when the fingerprint is missing or unreadable. `ctx version --json` prints the same data as records. The command is read-only — no install, no network, no writes — and `--version` still prints the bare CLI version.
