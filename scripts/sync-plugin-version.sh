#!/usr/bin/env bash
# Sync plugin.json versions with package.json
# Called by changesets after versioning to keep them in lockstep.
# The root manifest and the generated copilot/ subtree manifest both track the
# package version (pnpm build:copilot regenerates the subtree afterwards, but
# syncing here keeps the committed files correct even before the build runs).

set -euo pipefail

node -e "
const fs = require('fs');
const version = require('./package.json').version;
for (const file of ['plugin.json', 'copilot/plugin.json']) {
  if (!fs.existsSync(file)) continue;
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.version = version;
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  console.log('✓ Synced ' + file + ' to version ' + version);
}
"
