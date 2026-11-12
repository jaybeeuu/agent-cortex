---
"@jaybeeuu/agent-cortex": patch
---

Ship the skill anatomy doc into both installs. `write-a-skill` and `refactor-skill` read
`docs/skills/skill-anatomy.md`, but neither install contained it, so the reference was dead on any
machine without the checkout. Both installers now copy the document into the staged tree once per
install (`scripts/lib/docs.mjs`), and the skills name it through a new `{{PATH:skill_anatomy}}` entry
in `token-map.json`, so the token map stays the single source of the per-harness path. A new test
stages both installs and fails when a rendered skill references a repository doc the install does
not contain.
