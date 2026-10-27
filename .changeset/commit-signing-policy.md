---
"@jaybeeuu/agent-cortex": patch
---

Document the commit-signing expectation behind the "Commits must have verified signatures"
merge block. Agent commits are GPG-signed by the environment and verify as `valid`; the
`github-actions[bot]` commit on a Version Packages PR is `unsigned` because `GITHUB_TOKEN`
cannot sign, and the squash merge GitHub re-signs is what keeps it out of `main`'s history.
The new `docs/commit-signing.md` records the evidence, the ruleset reads that leave the
enforcing rule unresolved, and the release policy: land Version Packages by squash merge,
never put a signing key in CI secrets. `style-versioning` points at it.
