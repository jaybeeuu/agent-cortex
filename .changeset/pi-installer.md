---
"@jaybeeuu/agent-cortex": minor
---

Add the pi harness installer (`agent-cortex install pi`): composes agents from the canonical composable directories plus `pi/` sections, substitutes `{{TOOL:...}}` / `{{PATH:...}}` tokens against token-map.json's pi column (null-mapped tools dropped with warnings, paths resolved against the plugin root), and writes `<output>/agents/<name>.agent.md` plus token-substituted skill copies to `<output>/skills` (default `~/.pi/agent`). Supports `--dry-run`, `--output <dir>`, and an optional `--plugin-root <dir>` override. The shared composer gains pi-friendly options (`dropNullTools`, `pluginRoot`, `resolveRelativePaths`, `warn`) with the copilot/claude build defaults unchanged, and the root test suite is now wired into `pnpm test`.