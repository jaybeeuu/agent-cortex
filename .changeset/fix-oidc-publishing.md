---
"@jaybeeuu/agent-cortex": patch
---

Fix OIDC publishing by using custom publish script instead of changeset publish

Changesets doesn't natively support OIDC trusted publishing - it tries to use
`changeset publish` which requires an NPM_TOKEN. Replace with a custom script
that uses `pnpm pack` + `npm publish` directly, which properly picks up OIDC
tokens in GitHub Actions.
