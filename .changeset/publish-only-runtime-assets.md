---
"@jaybeeuu/agent-cortex": patch
---

Publish only runtime assets. `package.json` gains a `files` whitelist, so the tarball stops
shipping the whole repo: `.changeset/`, `test/`, `docs/`, `.github/`, `.junie/`, `.agents/`,
`AGENTS.md`, `tsconfig.json`, `pnpm-workspace.yaml` and the extensions' `node_modules/.bin`
symlinks are all excluded. `bin/`, `lib/`, `scripts/` (the `postinstall` installer lives there),
`skills/`, `agents/`, `extensions/`, `hooks/`, `claude/`, `claude-extras/`, `plugin.json` and
`token-map.json` remain, since the installers and the PI runtime read them. The `.beads/` task
database was previously excluded only by `.git/info/exclude`, which npm does not honour, so a
`pnpm pack` from a developer checkout could publish it — the whitelist closes that. Also adds the
`// @ts-check` pragma that `skills/planning/classify-bead/scripts/classify-bead.mjs` was missing,
matching the other skill scripts and the single-workspace decision.
