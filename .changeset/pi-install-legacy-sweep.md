---
"@jaybeeuu/agent-cortex": minor
---

`agent-cortex install pi` now sweeps the artifacts the pre-staged-model
installer rendered into pi's own user directory. Once the staged package at
`~/.agent-cortex/pi` is registered, those copies are a second source of the same
agent or skill — the skill-collision diagnostics the staged model exists to
remove — so the installer removes the ones it can attribute to agent-cortex:
`agents/<name>.agent.md` and `skills/<group>/<name>` for agents and skills it
ships or once shipped (`pipeline-worker`, the `migration` skill), plus a
`.agent-cortex-install.json` path record left in that directory listing those
copies.

The sweep is a one-time migration, not a standing rule: attribution is by name
from the package root, which cannot tell a rendered copy from a file you wrote
under the same name, so a finished migration is recorded in
`~/.agent-cortex/legacy-sweep.json` — keyed by the pi user directory, never
inside it — and nothing there is removed again. A completed migration leaves
`~/.pi/agent` with no agent-cortex file in it. Only a migration that removed
everything it attributed, from directories it could read, is recorded: a copy
that could not be deleted, or a directory that could not be listed, is warned
about and retried on the next install, and a record that cannot be written
warns without failing an install that has already registered. Files whose name this package
does not ship are left alone, and pi's
`extensions/` directory is never touched — no installer has ever written there,
so its contents are yours. pi's own `settings.json` and `keybindings.json` are
never touched either.

The sweep runs only after registration succeeds, follows the settings file the
installer reads (`~/.pi/agent`), and is skipped entirely by `--dry-run` and
`--output <dir>`. A pi agent dir relocated with `PI_CODING_AGENT_DIR` keeps its
copies: the installer does not inspect it.
