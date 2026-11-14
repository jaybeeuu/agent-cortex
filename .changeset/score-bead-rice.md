---
"@jaybeeuu/agent-cortex": minor
---

Add the `score-bead` skill and its `rice.mjs` script: RICE scoring for one bead, stored in
tracker metadata, with priority banding kept as a separate reviewable step.

`score <id> --reach --impact --confidence --effort --rationale` computes
`reach × impact × confidence ÷ effort` to one decimal and writes
`{"rice":{"reach","impact","confidence","effort","score","strategyVersion","assessedAt","rationale"}}`
with `bd update <id> --metadata`, so `bd show` renders components and total side by side and a
reader can redo the arithmetic. The strategy is read through `prioritise-work`'s validator and
path resolver — one definition of a valid rubric, one location, `--file` still honoured — and the
recorded `strategyVersion` is the file's own version, read after it validated. A missing or
invalid strategy refuses the score before the first `bd` call, so a refusal writes nothing at
all; a component outside its range (`confidence` outside `0..1`, `effort` at zero) is refused the
same way.

Re-scoring keeps history: the rationale carries the current argument followed by one `[prior]`
line per replaced score — old total, components, strategy version and date — so a version bump
records the new version without discarding the old arithmetic.

`band <id>` is read-only. It prints the priority the score implies plus the `bd update` command
that would apply it, and the skill applies that command only after a reviewer accepts it. P0 is
never produced by a band, and a bead already at P0 is refused before a proposal exists.

`using-agent-skills` routes scoring and banding questions to the new skill.
