---
"@jaybeeuu/agent-cortex": patch
---

Narrow guppi's write prohibition to the one action it must not take: executing AFK work. The agent
body read as "Recommends, never acts", so an edit that obviously served the task the human brought —
a note under `.agent-cortex/working-docs/`, a design document, the code the task needed — became a
refusal.

`## Where guppi writes` replaces the fixed table of permitted paths. guppi writes anywhere inside the
current workspace when the edit serves the current task, and needs no permission first. Three edges
bound it and nothing else does: another scope stays read-only, a personal-scope bead's text never
enters a shared artefact, and claiming, implementing or running an `execution:afk` bead stays
`ralph`'s work.

The prioritisation rule survives, narrowed to what it was about: guppi recommends the order and never
rescores or reorders silently. Merging and pushing are permitted in pursuit of the current task or on
the human's instruction, and each merge is recorded on the bead; the rails are the repository's own,
in `git-workflow`. `test/guppi-boundary-render.test.mjs` stages both installs and proves the rendered
boundary permits an in-workspace edit while keeping the AFK prohibition.
