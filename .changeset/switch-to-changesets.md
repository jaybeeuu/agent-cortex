---
"@jaybeeuu/agent-cortex": minor
---

Switch to changesets for automated releases

Replace manual version bumping and GitHub release creation with changesets automation:
- Added `@changesets/cli` for intent-based versioning
- Added `release.yml` workflow that creates "Version Packages" PRs and auto-publishes via OIDC
- Added `scripts/sync-plugin-version.sh` to keep `plugin.json` in lockstep with `package.json`
- Updated `style-versioning` skill to document the new workflow
- Removed old `publish.yml` (release-triggered) workflow

Going forward: run `pnpm changeset` to describe changes, merge to main, and the rest is automatic.
