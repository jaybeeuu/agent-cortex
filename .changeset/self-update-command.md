---
"@jaybeeuu/agent-cortex": minor
---

Add `agent-cortex self-update` (and its `ctx` / `cortex` aliases): update the globally installed CLI
through the manager that owns the install, then refresh the harness installs with the newly
installed binary. The owner is inferred from the running entry point's real path — pnpm's
`global/<v>` and `store/<v>/links` layouts, or npm's `lib/node_modules` — then confirmed by asking
that manager for its own global listing and matching this package's name and version, so a manager
on `PATH` is never used in place of the real owner: an unidentified or unconfirmed owner prints the
exact command and exits non-zero. It reports the installed version (read from the manifest beside
the entry point), the published version (from the confirmed manager's `view`), the owner, and the
command, and `--check` stops after the report writing nothing. A registry error is a distinct
failure that offers no update, and a failed install reports the manager's stderr and runs nothing
after it. Every process is spawned with an argv array (`execFile` / `spawn`), never a shell string.
