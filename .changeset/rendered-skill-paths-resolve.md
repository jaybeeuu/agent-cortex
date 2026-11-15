---
"@jaybeeuu/agent-cortex": minor
---

Resolve `{{PATH:skills/...}}` rows to the tree each install stages, so an agent row
always names a file the install contains. Claude Code stages skills flat
(`skills/<name>/SKILL.md`), so a row authored against the repository's grouped tree lost
its group segment and rendered as a bare relative path that resolved to nothing. The
staged shape is now declared per harness in `token-map.json`'s `layouts` table, the
claude installer resolves agent rows against the plugin root as it already did for
skills, and `test/rendered-paths-resolve.test.mjs` stages both installs and fails when
any rendered row names a file that is not there.
