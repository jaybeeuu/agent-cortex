---
"@jaybeeuu/agent-cortex": patch
---

Add `agent-cortex --version` / `-V`, which prints the version of the package the CLI is running
from — a bare semver, nothing else — and exits 0. The version is resolved from the CLI's own
`package.json` relative to `bin/agent-cortex.mjs`, not from the cwd or `node_modules`, so a
published install reports the version it was installed at and two installs on one machine can be
told apart. Like `--help`, the flags are only recognised as the first argument, so they never
shadow a command's own options. A manifest that is missing, unreadable, malformed, or has no
`version` string is a broken install: it prints a one-line diagnostic on stderr and exits 1
rather than reporting a bogus version with a success exit. `--help` lists the new flags.
