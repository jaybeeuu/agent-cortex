---
"@jaybeeuu/agent-cortex": minor
---

Add `ctx update`, which refreshes installed harnesses by re-running their installers. Bare
`ctx update` lists every harness with its installed version and the CLI version, then asks which
to refresh; a non-interactive shell prints the same table plus the flags and exits non-zero
instead of blocking. `ctx update pi claude` refreshes exactly the named harnesses, `ctx update -a`
refreshes every harness that is not at the CLI version, and `ctx update -a -f` re-runs every
installer regardless of version. The report gives each harness its previous and new version and
the artifacts the installer wrote. Selection and reporting are the only additions: every refresh
goes through the existing `bin/installers/` entry points, so update-vs-install stays the
installer's decision.
