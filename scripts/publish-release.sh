#!/usr/bin/env bash
# Custom publish script for changesets that uses pnpm pack + npm publish
# This is needed because changeset publish doesn't properly handle OIDC

set -euo pipefail

# Check if there are any packages to publish
VERSION=$(node -p "require('./package.json').version")
PACKAGE_NAME=$(node -p "require('./package.json').name")

echo "Publishing $PACKAGE_NAME@$VERSION"

# Check if this version is already published
if npm view "$PACKAGE_NAME@$VERSION" version 2>/dev/null; then
  echo "Version $VERSION is already published, skipping"
  exit 0
fi

# Pack the tarball
TARBALL=$(pnpm pack | tail -n 1)
echo "Created tarball: $TARBALL"

# Publish using npm (which picks up OIDC automatically in GitHub Actions)
npm publish "$TARBALL"

echo "✓ Published $PACKAGE_NAME@$VERSION"

# Create git tag
git tag -a "v$VERSION" -m "Release $PACKAGE_NAME@$VERSION" || echo "Tag already exists"
