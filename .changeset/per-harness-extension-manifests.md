---
"@jaybeeuu/agent-cortex": minor
---

Add committed per-harness extension manifests (`pi.extensions.json`,
`claude.extensions.json`) and an `agent-cortex ext install --harness pi|claude`
command that reads them and installs the declared third-party extensions through
each harness's own installer (`pi install <source>`; `claude plugin install <id>
-y`). The manifest is the single source of truth — the CLI never writes it, so
adding an extension is an edit + commit reviewed via the normal PR flow. Installs
are idempotent (an already-present source is skipped, so a second run installs
nothing), a failing extension warns and lets the rest proceed (the command exits
non-zero so callers can see the partial failure), and `--dry-run` prints the
deterministic plan without installing or writing anything (it still reads the
harness's local store — for claude, a read-only `claude plugin list --json`).
Because the manifest now owns the third-party pi packages, they are removed from
the `pi/settings.json` template — re-run `agent-cortex ext install --harness pi`
after `agent-cortex install pi` to re-register them. The npm `postinstall` hook
is unchanged, and agent-cortex's own bundled extensions stay out of the
manifests (they ride pi package discovery).
