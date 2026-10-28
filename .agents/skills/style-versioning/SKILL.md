---
name: style-versioning
description: Automated release workflow using changesets. Use when completing work that needs a release, asking "how do I version this?", or when any change needs to be shipped to npm.
---

# style-versioning

This repo uses **changesets** for fully automated versioning and publishing. No manual version bumps, no manual releases.

## When to use

Trigger this skill when:
- Completing work that needs a release
- Asking "how do I version this change?"
- Creating a PR that changes shipped behaviour

## Creating a changeset (agent instructions)

**Do NOT run `pnpm changeset`** — it is interactive and will waste tokens on prompts and ANSI codes. Instead, write the changeset file directly.

### File format

A changeset is a markdown file in `.changeset/` with YAML frontmatter:

```markdown
---
"@jaybeeuu/agent-cortex": <bump>
---

<Short description of the change>
```

Where `<bump>` is one of: `patch`, `minor`, or `major`.

### How to create one

1. Choose a descriptive kebab-case filename (e.g., `fix-status-bug.md`, `add-webhook-skill.md`)
2. Choose the bump type:
   - `patch` — bug fix, clarification, no behaviour change
   - `minor` — new skill, agent, feature, or meaningful behaviour change
   - `major` — breaking change (removed skill, renamed agent, incompatible workflow)
3. Write the file directly using the `write` tool:

```
write(".changeset/fix-status-bug.md", `---
"@jaybeeuu/agent-cortex": patch
---

Fix status bead showing wrong priority after update
`)
```

4. Commit the changeset file along with the code changes

### Rules

- **Every PR adds a changeset.** CI fails otherwise. The only opt-out is the
  `no-publish` label (see below).
- The frontmatter package name must match exactly: `"@jaybeeuu/agent-cortex"`
- The description should be one or two sentences, user-facing (it goes into CHANGELOG.md)
- One changeset per PR. If a PR has multiple unrelated changes, use multiple changeset files.
- The filename doesn't matter to changesets — only the frontmatter and description do.

## The PR gate

`changeset-check` runs on every pull request and fails it unless the PR adds a
`.changeset/*.md` file. **Publishing is the default; `no-publish` is the only
opt-out** — skipping a release is an explicit, reviewable decision, never an accident.

| Exemption | Applies to |
|---|---|
| `changeset-release/*` head branch, or actor `github-actions[bot]` | the changesets bot's Version Packages PR — it consumes changesets and adds none of its own |
| `no-publish` label | a PR that genuinely ships nothing |

The `no-publish` label must exist in the repository's label settings — a one-off
human step (`gh label create no-publish`), not something a PR can ship. If the gate
fails and the PR really ships nothing, ask for the label; do not manufacture a
changeset to make it green.

## After merge to main

The `release` job in `.github/workflows/ci.yml` handles everything automatically:

1. **Detects new changesets** on main
2. **Creates a "Version Packages" PR** — the `version` step runs `pnpm version-packages`, which bumps `package.json`, syncs `plugin.json` (via `scripts/sync-plugin-version.sh`), updates `CHANGELOG.md`, and regenerates the committed Copilot output (`pnpm build:copilot`; the Claude plugin is materialised at install time with the package version, so it has no committed output to regenerate) so the drift gates never fail on a version bump
3. **When "Version Packages" is merged**:
   - Creates a git tag
   - Publishes to npm — `pnpm publish-package` packs with `pnpm pack` and publishes with `npm publish --provenance --access public`. Authenticates via npm Trusted Publishing (OIDC): the release job's `id-token` permission lets npm exchange a GitHub OIDC token for a short-lived npm token at publish time, so no `NPM_TOKEN` secret or `.npmrc` auth config is required — only the one-time npm-side Trusted Publishing setup on npmjs.com (package → Access → Trusted Publishing → GitHub repo `jaybeeuu/agent-cortex` + workflow `.github/workflows/ci.yml`)
   - Creates a GitHub release automatically

`changesets/action` execs the `version`/`publish` inputs without a shell, so each
must be a single unquoted command token — keep release logic in pnpm scripts
(`version-packages`, `publish-package`, `publish-noop`), never inline shell strings.

### Approve CI on the Version Packages PR

The version PR arrives `BLOCKED` with an empty check list, and nothing is broken:
`changesets/action` pushes that branch with `GITHUB_TOKEN`, so GitHub parks the CI
run the push creates behind **“Approve workflows to run”** (`action_required`, zero
jobs). A parked run reports no checks, so the five required contexts are
unsatisfiable until someone approves it. Approve it from the PR's merge box, or:

```bash
run=$(gh run list --branch changeset-release/main --limit 20 \
  --json databaseId,conclusion --jq 'map(select(.conclusion=="action_required"))[0].databaseId')
gh api -X POST "repos/{owner}/{repo}/actions/runs/$run/approve"
```

An approval is per head commit. Every merge to `main` force-updates the version
branch and starts a fresh parked run, so approve immediately before merging the
version PR — not once per release. Do not reach for a PAT or GitHub App token to
skip this: one click is cheaper than a long-lived credential in repository
secrets, and the `GITHUB_TOKEN` the job already holds cannot approve its own run.

Which of the two publish scripts runs is decided per push, not hard-coded: labels are
invisible on a push event, so the job resolves the PR merged for the pushed commit via
the GitHub API and reads its labels — `publish-noop` when the PR carried `no-publish`,
`publish-package` otherwise. That needs no new secret or scope; the job already holds
`GITHUB_TOKEN` and `pull-requests: write`. A direct push with no merged PR resolves to
no labels and so publishes, which keeps a genuine publish of an already-published
version failing loudly — there is deliberately no idempotency guard.

### Merge method and commit signatures

Land a Version Packages PR with `gh pr merge <n> --squash`. Agent and human commits here are
GPG-signed by the environment and verify as `valid`; the `github-actions[bot]` commit is
`unsigned` because `GITHUB_TOKEN` cannot sign. The commit that lands is signed by GitHub,
which is why `main`'s history reads `valid`: PR #161's unsigned head `fe7ef84` landed as
`dd347471b1` with `committer=GitHub`, `verified=true`.

Squash re-signs the landing commit; it does not escape an enforced signature rule. GitHub
evaluates a pull request by creating a test merge commit and checking the commits it
introduces — head-branch commits included — so an enforced `required_signatures` rule blocks
a squash merge too, and the remedy is then a signed commit on the branch, not another merge
method. `allow_merge_commit` is off and `required_linear_history` is on, so a merge commit is
not an option — squash or rebase only, and only squash lands a commit GitHub signs.

See `docs/commit-signing.md` for the evidence, the ruleset reads that show only
repository-level rules applying to `main` (a read that covers organization rules too), and the
human-only follow-ups, including the merge probe that closes AC1.

### Version lockstep

All version numbers stay in lockstep automatically:

1. `package.json` → bumped by changesets
2. `plugin.json` → synced by `scripts/sync-plugin-version.sh`
3. `CHANGELOG.md` → generated by changesets

**Never bump versions manually.** Always create a changeset file.

## Common mistakes

- **Running `pnpm changeset`**: Interactive, wastes tokens. Write the file directly.
- **Bumping versions manually**: Don't touch `"version"` in `package.json` or `plugin.json`. Create a changeset.
- **Omitting the changeset**: CI fails the PR. Publishing is the default; the only
  opt-out is the `no-publish` label, which must already exist in the repo's settings.
- **Wrong bump type**: `patch` for fixes, `minor` for additions, `major` for breakage. When in doubt, ask the user.
- **Wrong package name in frontmatter**: Must be `"@jaybeeuu/agent-cortex"` exactly.
- **Merging a Version Packages PR with anything but squash**: the bot's commit is unsigned,
  and squash is the path this repo has landed on (a rebase merge adds the head-branch commit
  without signature verification).
  Squash does not, however, bypass an enforced signature rule — if one is confirmed, the
  branch needs a signed commit. See `docs/commit-signing.md`.

## What changed from the old workflow

| Before (manual) | After (changesets) |
|---|---|
| Agent bumps versions locally | Agent writes a changeset file |
| Manual GitHub release creation | Automated by the `release` job in `ci.yml` |
| `publish.yml` triggered by release | `ci.yml` release job on push to main |
| Version sync was manual | `sync-plugin-version.sh` runs automatically |
