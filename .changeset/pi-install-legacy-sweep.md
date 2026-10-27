---
"@jaybeeuu/agent-cortex": minor
---

`agent-cortex install pi` now sweeps the artifacts the pre-staged-model
installer rendered into pi's own user directory. Once the staged package at
`~/.agent-cortex/pi` is registered, those copies are a second source of the same
agent/skill/extension — the skill-collision diagnostics the staged model exists
to remove — so the installer deletes the ones it can attribute to agent-cortex:
`agents/<name>.agent.md` for agents it ships, `skills/<group>/<name>` for skills
it ships, `extensions/<entry>` for the extensions tree it ships, the orphans it
once shipped but no longer has a source for (`pipeline-worker`, the `migration`
skill), and the old installer's `.agent-cortex-install.json`.

pi's own files (`settings.json`, `keybindings.json`) and your own agents, skills,
and extensions are never touched — attribution is by name from the package root
rather than by directory, so a skill you added inside a skill group survives.
The sweep runs only after registration succeeds and is skipped entirely by
`--dry-run` and `--output <dir>`.
