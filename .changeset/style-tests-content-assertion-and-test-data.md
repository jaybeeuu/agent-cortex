---
"@jaybeeuu/agent-cortex": minor
---

Encode test-quality rules into `style-tests`: the full agreed principle set (behaviour over
implementation, mocking only at external edges, module-boundary units, realistic
LocalStack/TestContainers integration, test independence, CI-only truth, spec-by-test, and
more), a blanket ban on asserting the static contents of a file (config, markdown, terraform,
snapshots) with the behaviour-not-inventory distinction, and test-data construction rules —
inline data, no shared mutable top-level fixtures, and small configurable factories over
repeated full literals. The content-assertion ban and the test-data rules land as red-flag rows
plus verification-checklist items. `style-tests/SKILL.md` deliberately occupies the full
~150-line `SKILL.md` budget so the principles load automatically, rather than splitting into
`REFERENCE.md`.
