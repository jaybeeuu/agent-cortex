---
"@jaybeeuu/agent-cortex": patch
---

Drop the hardcoded skill blurb from the pi `session-start` extension. The blurb advertised three
skills with `/skill:<name>` syntax that pi cannot resolve, and pi's own system prompt already lists
every discovered skill with its absolute `SKILL.md` path, so the local copy was incomplete and
drifted from `skills/` silently — verbatim text an agent reads first each session (and on
2026-10-27 misread a missing-extension outage as a missing-skills problem). Session start now
injects only the project context files (AGENTS.md, `docs/user-preferences.md`). The extension moves
to `extensions/session-start/` (`index.ts`, `package.json`, `README.md`, `index.test.ts`) per the
one-directory-per-extension convention; the new test pins the contract: no `/skill:` syntax, no
hardcoded skill names, context files injected when present, nothing injected when absent.
