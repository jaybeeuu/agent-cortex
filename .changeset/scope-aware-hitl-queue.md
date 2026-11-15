---
'@jaybeeuu/agent-cortex': minor
---

Make the HITL queue scope-aware: it reads several `bd` workspaces and keeps one writable.

A scope list — `.agent-cortex/scopes.json` in the repository, then
`~/.agent-cortex/scopes.json` (`AGENT_CORTEX_HOME` overrides the root), then one implicit scope
for the current workspace — names each workspace, its kind (`code`, `personal`, `ops`) and whether
it is read-only. `readOnly` defaults to `true`, and a scope is writable only when it is not marked
read-only *and* it is the current workspace, so a copied list cannot widen the writable set on
another machine.

Every configured scope contributes rows, each tagged with its scope. A scope whose directory is
missing or carries no `.beads` of its own is reported `unavailable` with the reason and skipped —
bd resolves a workspace by walking up, so the marker check is what stops one workspace's beads
being attributed to another. A failed `bd` call marks its own scope unavailable; the run still
exits `0`. A read-only scope passes through one guard that refuses any call other than the two
reads the queue issues, so the boundary survives a later edit.

One daily scope note sits above the ranked list, quoting the `- daily: <scope>, …` line from the
personal scope's own strategy and citing its version, section and scope. `--shared`
(`AGENT_CORTEX_QUEUE_SHARED=1`) marks output that leaves the machine: personal scopes are not read,
so personal rows and the daily note are withheld and counted.

`prioritise-work` documents the daily line, and guppi's agent text explains scopes, the note and the
privacy boundary.
