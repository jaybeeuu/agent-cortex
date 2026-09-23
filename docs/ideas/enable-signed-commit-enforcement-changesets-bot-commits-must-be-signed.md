# Idea: Enable signed-commit enforcement (changesets bot commits must be signed)

## Status
Backlog idea (not implementation-ready)

## Created
2026-09-02

## Problem
GitHub's signed-commits protection on `main` (the "Require commit signing" rule) is currently disabled in this repo. Enabling it hardens main against impersonated/forged commits — but the automated release flow depends on the changesets bot's unsigned "chore: version packages" commits (which bump `package.json`/`plugin.json`/`CHANGELOG.md`). Flipping the rule on as-is would break releases.

## Who benefits
The author. Main-branch history becomes verifiably authentic — every commit attributable to a known key — protecting the npm-published package's supply chain, and releases keep flowing because the automation satisfies the same rule.

## Proposed outcome
`main` requires signed commits AND the automated changesets release commits satisfy that requirement — i.e. enabling "Require commit signing" no longer breaks the version-packages / release pipeline. Direction: the automation signs its own commits inside CI (no manual release steps).

## Validity check
- Evidence we already have: the rule is currently disabled (user statement). The release pipeline's version commits are created by the changesets action as `github-actions[bot]`, which does not sign by default — enabling the rule today fails those commits. Restructuring "how changesets works in CI" is therefore required, and this overlaps with the adjacent `unified-ci-pipeline` idea.
- Riskiest assumption: that a clean path exists for GitHub Actions to produce signed commit(s) in this repo's flow without breaking or significantly complicating the automated loop (CI-hosted keys and ruleset exceptions both have setup costs and failure modes).
- What would invalidate this idea: if the only workable fix forces human-run releases (moving versioning out of automation), the cost/benefit flips — the idea dies or reverts to the status quo of signing human commits only.

## Constraints
- Scope: this repo only.
- Must not break the changesets-driven versioning loop (`package.json`/`plugin.json`/`CHANGELOG.md` stay in lockstep automatically).
- CI changes go through the normal PR + review flow.
- The release job is also the target of the pending npm OIDC publish work (agnt-ctx-0zy8) — both touch the same job, so sequencing matters when this idea graduates.

## Next validation step
Determine how the changesets commit gets signed in CI on this repo — cheapest prototype: scratch repo (or the version branch) exercising the signing path end-to-end without touching `main`'s rule, then evaluate the rule change on `main`.

## Notes
Recorded 2026-09-02. Backlog capture only — no active work planned; revisit after the install-manager epic (pi/claude/copilot) settles. Adjacent to `docs/ideas/unified-ci-pipeline.md` (CI/release restructure).