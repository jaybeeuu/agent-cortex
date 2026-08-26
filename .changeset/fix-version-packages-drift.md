---
"@jaybeeuu/agent-cortex": patch
---

Fix the release pipeline so Version Packages PRs regenerate generated output. `changesets/action` execs the `version`/`publish` inputs without a shell, so quoted multi-command strings crash (`bash -c '...'` split on whitespace → unterminated quote, exit 2). The chain now lives in exec-safe single-command pnpm scripts: `pnpm version-packages` bumps versions, syncs `plugin.json`, then regenerates the committed Claude/Copilot agent output so the drift gates never fail on the bumped version; `pnpm publish-package` performs the pack + provenance publish.