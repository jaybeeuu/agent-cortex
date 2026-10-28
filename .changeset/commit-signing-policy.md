---
"@jaybeeuu/agent-cortex": patch
---

Document the commit-signing expectation behind the "Commits must have verified signatures"
merge block. Agent commits are GPG-signed by the environment and verify as `valid`; the
`github-actions[bot]` commit on a Version Packages PR is `unsigned` because `GITHUB_TOKEN`
cannot sign. The squash merge GitHub performs re-signs the commit that lands, which is why
`main`'s history reads `valid` — but a squash merge does **not** escape an enforced signature
rule, since GitHub checks head-branch commits through its test merge, so the remedy in that
case is a signed commit rather than a different merge method. The new `docs/commit-signing.md`
records the evidence, the ruleset reads that show no signature rule applied to `main` at
either repository or organization level (while org ruleset definitions stay unreadable), the
open acceptance criterion with its human merge probe, and the release policy: land Version
Packages by squash merge, never put a signing key in CI secrets, with an explicit
contingency if an organization-level signature rule turns out to be enforced.
`style-versioning` points at it.
