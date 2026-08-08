#!/usr/bin/env bash
# Sync plugin.json version with package.json
# Called by changesets after versioning to keep them in lockstep

set -euo pipefail

VERSION=$(node -p "require('./package.json').version")

# Update plugin.json version field
node -e "
const fs = require('fs');
const plugin = JSON.parse(fs.readFileSync('plugin.json', 'utf8'));
plugin.version = '$VERSION';
fs.writeFileSync('plugin.json', JSON.stringify(plugin, null, 2) + '\n');
"

echo "✓ Synced plugin.json to version $VERSION"
