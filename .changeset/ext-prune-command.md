---
"@jaybeeuu/agent-cortex": minor
---

Add `agent-cortex ext prune [--harness pi|claude]`, the local-only uninstall half
of the extension-manifest workflow. It lists the extensions installed in the
harness's own store (`~/.pi/agent/settings.json` `packages` for pi, `claude
plugin list --json` for claude), prompts for one by number, confirms, and
uninstalls it through that harness's CLI (`pi remove <source>`; `claude plugin
uninstall <id> -y`) — the list is offered again until it is empty, and the
command exits non-zero when an uninstall fails. Entries the committed manifest
declares are flagged, since `ext install` would put them straight back. The
committed manifests are never written: dropping an extension from one stays an
edit + commit in GitHub, which is what keeps experiment → prune-locally →
curate-the-manifest safe. `--dry-run` prints the same list and removes nothing,
`--harness` defaults to pi, piped input is consumed in order so the flow is
scriptable, and an input that ends early exits cleanly instead of hanging. Both
harnesses share one store reader (`bin/installers/ext-store.mjs`) with `ext
install`, and the prompt is plain readline — no runtime dependencies, no LLM
calls.
