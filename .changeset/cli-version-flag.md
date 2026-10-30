---
"@jaybeeuu/agent-cortex": patch
---

Add `agent-cortex --version` / `-V`, which prints the version of the package the CLI is running
from — a bare semver, nothing else — and exits 0. The version is resolved from the CLI's own
`package.json` relative to `bin/agent-cortex.mjs`, not from the cwd or `node_modules`, so a
published install reports the version it was installed at and two installs on one machine can be
told apart. `--help` lists the new flags.
