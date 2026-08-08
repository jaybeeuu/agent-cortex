---
"@jaybeeuu/agent-cortex": patch
---

Fix changesets workflow by adding root package to workspace

Changesets couldn't find @jaybeeuu/agent-cortex because pnpm-workspace.yaml
only listed skills/*/scripts and extensions/*. Adding "." makes the root
a workspace member so changesets can version it.
