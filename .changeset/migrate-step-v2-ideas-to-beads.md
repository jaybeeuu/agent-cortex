---
"@jaybeeuu/agent-cortex": patch
---

Add step v2 to `agent-cortex migrate` — loose idea files become `kind:idea` beads — and delete
the retired idea scaffold script.

`docs/ideas/*.md` (one level of nesting included) previously had to be migrated by hand. Step v2
reads each file, maps its sections onto the bead fields, and creates a `kind:idea` +
`execution:hitl` bead: `--description` takes the problem and outcome sections, `--design` the how
sections, and everything else — including any `##` section the template never named — lands in
`--notes` with its marker intact, so the flesh-out pass can still find sections by name. No line
of a source file is dropped. Priority comes from the first `P0`–`P4` token in the file and falls
back to P4 (backlog), and every bead carries the promotion criterion a `task` bead needs to lint
clean. The step reads the files and never writes or deletes one: retiring them is the repo's own
cutover.

It is idempotent by collision, not by marker: before creating anything it lists the existing
`kind:idea` beads and skips a file whose title matches one (prefix and punctuation ignored) or
whose path a bead names under a `## Provenance` heading — the second rule is what stops a
duplicate of a record a human had already migrated by hand, while a passing cross-reference
elsewhere in a bead's notes does not count. Re-runs and resumed applies therefore no-op, and the
dry run prints one `<file> → <title> (P<n>)` line per pending file with zero writes.

`skills/planning/record-idea/scripts/new-idea.sh` is gone: it wrote the markdown records the bead
flow replaced, and nothing has called it since `record-idea` started creating beads. The
`migration` skill's `SKILL.md` and `REFERENCE.md` document the shipped v2 mechanics — the section
alias inventory, the priority rule and its `P0-P4` caveat, the collision skip, and the deletion
ordering.
