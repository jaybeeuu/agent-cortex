---
"@jaybeeuu/agent-cortex": patch
---

Fix `See Also` links in the materialised Claude plugin. `install claude` copies skills flat
(`skills/<name>/`), so a handoff authored against the grouped tree (`../../style/style-code/SKILL.md`)
lost its group segment and 404'd. The flat copy now rewrites cross-skill links to the sibling path
(`../style-code/SKILL.md`) via `scripts/lib/skill-links.mjs`; the pi install, which keeps the
grouping, is unchanged.
