---
"@jaybeeuu/agent-cortex": patch
---

Move the skill guidance onto the two-axis model. `classify-bead` applies `execution:afk` /
`execution:hitl` instead of the retired `implementation-type:` namespace — in the skill, its
`REFERENCE.md`, the deterministic classifier's constants, and its tests — while its rubric,
tiers, legacy `## Type` read, and CLI stay unchanged. `record-idea` captures ideas as `kind:idea`
beads (`execution:hitl`, priority, `--acceptance` promotion criteria) instead of scaffold files
through `new-idea.sh`; its interview adds three bounded implementation questions and a
`## Design so far / provenance` section, and `FORMAT.md` becomes the bead field mapping that keeps
`##` section markers inside the description, design, and notes. `bd-tool` documents the
`execution:<class>` and `kind:idea` rows, the query-filter-only semantics, the measured fact that a
bare `bd ready` does list idea beads (so it needs `--exclude-label kind:idea`), and the new
`record-idea` / `flesh-out-idea` cross-references. New `flesh-out-idea` skill answers "which ideas
are ready?" with `bd ready -l kind:idea`, drives a deepening interview, writes section markers back
with `--design` / `--append-notes`, and documents the promotion path (idea bead becomes the
`kind:epic` epic node, `execution:afk` children joined by `--parent`, ordering by dependency).
