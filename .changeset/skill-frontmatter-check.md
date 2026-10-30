---
"@jaybeeuu/agent-cortex": patch
---

Fail `pnpm lint` when a SKILL.md frontmatter cannot be parsed, is missing `name` or `description`, or has a description longer than 1024 characters. PI previously dropped such skills silently.
