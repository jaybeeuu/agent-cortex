---
"@jaybeeuu/agent-cortex": patch
---

Record the dev loop in `docs/dev-loop.md`: the three-command refresh of the installed runtime
(`pnpm add -g …@latest`, then `agent-cortex install pi` and `agent-cortex install claude`, with
`--dry-run` for the plan and a restart of both harnesses to apply), the installed layout under
`~/.agent-cortex`, and how to try uncommitted work without overwriting it — stage the checkout
with `install pi --output <scratch dir>` and load it with `pi -ne -e <scratch dir>`, which writes
no settings and needs no undo. The page also states the boundary plainly: the checkout is what is
developed, `~/.agent-cortex` is what is run, and a path inside `~/src` is never a package source,
with the two historical violations named as anti-patterns. `README.md` links it from the pi
staging section.
