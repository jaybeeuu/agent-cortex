---
"@jaybeeuu/agent-cortex": minor
---

Stage-chore expansion pours a shipped bd formula instead of driving ~16 `bd` calls. `pipeline.formula.json`
sits beside `pipeline.json` and declares the same stages, text, labels and stage-to-stage edges; both
installers copy it to the consumer's `<project>/.beads/formulas/pipeline.formula.json` (the filename is
the formula id) and say in their output that the copy is an untracked file. A project with no `.beads/`
is reported and the install continues.

`create-chores.mjs` now pours when that formula is present and the parent has no stage chore yet, then
reparents each step onto the parent and deletes the inert molecule root, recording the pour on the
feature bead. Convergence is rebuilt rather than inherited — a second pour duplicates the tree silently
— so an already-expanded parent stays on the per-stage path, and a missing or unusable formula falls
back to it. stderr states once which path ran.

The per-stage path no longer wraps a chore's title and description in `JSON.stringify`, which bd stored
verbatim; both paths now write the `pipeline.json` text as written.
