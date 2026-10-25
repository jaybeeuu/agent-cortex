---
"@jaybeeuu/agent-cortex": minor
---

`agent-cortex install pi` now registers the staged package with pi: after
staging `~/.agent-cortex/pi` it drives pi's own `pi install` so pi loads the
agents, skills, and extensions from that directory. Registration is idempotent
by state — a re-run after `git pull && agent-cortex install pi` changes nothing —
and a source pointing at a raw agent-cortex checkout is removed first, so exactly
one agent-cortex source stays configured. A superseded source that `pi remove`
cannot drop fails the install rather than reporting success — two configured
sources both load, so leaving both in place is a failed registration, not a
warning. The installer still writes nothing into `~/.pi/agent`; it only reads
pi's `settings.json` to decide the plan. A missing `pi` CLI warns and prints the
exact commands (failing only with `--require-register`), and `--dry-run` prints
the registration plan without writing or spawning anything. `--output <dir>`
remains the stage-only form.
