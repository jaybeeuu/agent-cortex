---
"@jaybeeuu/agent-cortex": patch
---

**Enforce changeset requirement in CI** — PRs that modify `extensions/`, `skills/`, `agents/`, `package.json`, or `plugin.json` now fail CI unless they include a `.changeset/*.md` file. Prevents merges that the release pipeline can't pick up.
