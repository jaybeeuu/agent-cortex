---
"@jaybeeuu/agent-cortex": patch
---

Move the composable agent-directory validator from
`skills/productivity/validate-agent-dir/scripts/` to `scripts/validate-agent-dir.mjs`. The
directory had no `SKILL.md`, so neither installer shipped it while it still looked like a shipped
skill, and the module validates this repository's own `agents/` layout — repo tooling, not a
portable skill. Its filesystem probes are now async (`validateAgentDir` returns a promise),
matching the no-`*Sync` rule for `scripts/`.

`agents/README.md` (Validation) and `test/validate-agent-dir.test.mjs` point at the new path. No
skill, agent, hook, or installer behaviour changes.
