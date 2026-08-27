---
"@jaybeeuu/agent-cortex": patch
---

Fix Release CI npm publish (ENEEDAUTH): the release job now publishes via npm Trusted Publishing (OIDC) — no `NPM_TOKEN` secret or `.npmrc` auth config. The `release` job's `id-token: write` permission is the only workflow-side requirement; npm exchanges the GitHub OIDC token for a short-lived npm token at publish time.

**One-time npm-side setup required** (no GitHub secret): on npmjs.com, open the package `@jaybeeuu/agent-cortex` → Access → Trusted Publishing → Add new publisher → GitHub, select the `jaybeeuu/agent-cortex` repository and the `.github/workflows/ci.yml` workflow. Publishing then needs no token configuration.