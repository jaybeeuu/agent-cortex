---
"@jaybeeuu/agent-cortex": minor
---

`self-update` now reports the version boundary and only refreshes when the CLI changed. After a
successful install it reads the version the newly installed binary reports and prints
`cli        <before> → <after>`, then hands the terminal to that binary's `update -a` and exits with
the refresh's own exit code, so a failed refresh is visible to the caller. The refresh is skipped in
three cases: `--check`, a failed update, and an install already at the published version (which now
also installs nothing and points at `agent-cortex update -a` instead). A refresh that cannot start
prints the reason and the exact command to run by hand instead of exiting 1 silently. The README,
`docs/dev-loop.md` and `--help` document the act-by-default behaviour, `--check`, the owner
detection rule, and the re-exec chain with its failure output.
