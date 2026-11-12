---
"@jaybeeuu/agent-cortex": patch
---

Fail `agent-cortex install pi` when a skill sits outside `skills/<group>/<name>`.

pi advertises a skill by the absolute path of its `SKILL.md`, and the installer copies exactly
`skills/<group>/<name>`. A skill authored deeper was skipped without a trace, so no session was
ever told about it. The install now stops and names the offending path.

`docs/dev-loop.md` records the related limit that needs no code: a session lists its skills when
it starts, so a session already open across a re-stage holds the paths it was given.
