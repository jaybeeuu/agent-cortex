# style-versioning

## When to use

Trigger this skill when:
- Bumping the version in package.json or plugin.json
- Preparing a release or publishing to npm
- Updating CHANGELOG.md with a new version header
- Any change that affects versioning semantics

## What it does

Enforces that all three version numbers stay in lockstep:

1. `package.json` → `"version"` field
2. `plugin.json` → `"version"` field
3. `CHANGELOG.md` → top-level `## X.Y.Z` header

## How to apply

### On every version bump

1. **Check current state**: All three versions must already match. If they don't, stop and ask the user — this is a drift that needs explicit resolution.

2. **Determine the new version** using semantic versioning:
   - `major`: breaking changes (removed skill, renamed agent, incompatible workflow change)
   - `minor`: new skill or agent added, or meaningful behavior/step changes to existing skills
   - `patch`: bug fix, clarification, or clarification with no behavior change

3. **Bump all three together**:
   - Update `package.json` `"version"` field
   - Update `plugin.json` `"version"` field
   - Add a new `## X.Y.Z` header at the top of `CHANGELOG.md`

4. **Verify alignment**: Read all three files back and confirm the versions match exactly.

### On commit

- The version bump must be in the same commit as the change — no follow-up commits.
- Use a clear commit message: `chore: bump version to X.Y.Z` or `feat: <description> (X.Y.Z)`.

## Common mistakes

- **Drift**: Updating only `plugin.json` but not `package.json` (or vice versa). This breaks downstream consumers.
- **Stale CHANGELOG**: Bumping versions but forgetting to add a `CHANGELOG.md` entry.
- **Wrong header format**: Using `## v1.2.3` instead of `## 1.2.3` (no `v` prefix in CHANGELOG).
- **Out-of-order entries**: Adding a new version header below an older one (must always be at the top).

## Verification

Run this check to confirm alignment:

```bash
PKG=$(node -p "require('./package.json').version")
PLG=$(node -p "require('./plugin.json').version")
CL=$(grep -m1 '^## ' CHANGELOG.md | sed 's/^## //')

echo "package.json: $PKG"
echo "plugin.json:  $PLG"
echo "CHANGELOG.md: $CL"

[ "$PKG" = "$PLG" ] && [ "$PLG" = "$CL" ] && echo "✓ All versions match" || echo "✗ Version mismatch"
```

All three must be identical.
