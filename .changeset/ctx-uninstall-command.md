---
"@jaybeeuu/agent-cortex": minor
---

Add `ctx uninstall`, the inverse of `ctx install`. It removes a harness install and
the registration that goes with it: pi is deregistered through the pi CLI (pi's own
`settings.json` is read, never written), and claude through the `claude plugin` CLI
plus removal of exactly the `enabledPlugins` + `extraKnownMarketplaces` entries the
install declared, so personal config and entries the user added survive. With no
argument it prompts from a table of installed harnesses, and a non-interactive shell
prints that table plus the flags and exits non-zero; a named harness that is not
installed is a no-op, running it twice reports "already absent", and `--dry-run`
writes nothing. `--all` confirms on a terminal and is the explicit opt-in when
unattended; it removes harness installs only — the CLI and the shared
`~/.agent-cortex` root stay, any ralph worktree is reported and left, and the report
says which.
