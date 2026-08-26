---
"@jaybeeuu/agent-cortex": patch
---

Fix Release CI npm publish (ENEEDAUTH): the release job now authenticates to the npm registry via a `NODE_AUTH_TOKEN` env var wired from the `NPM_TOKEN` Actions secret, plus a repo `.npmrc` auth-token reference, so `npm publish --provenance --access public` can publish. Add the `NPM_TOKEN` Actions secret (npm publish rights) in repo settings.