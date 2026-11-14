---
"@jaybeeuu/agent-cortex": minor
---

Give the pipeline one shared writer for the bead trail, and stop the file-based progress logs.

`skills/workflow/run-pipeline-stage/scripts/trail-entry.mjs` appends one checkpoint to a bead's
notes with `bd note` and records the refs the caller names as provenance events. Every entry
carries the three mandatory fields — Outcome (`done`/`blocked`/`partial`), Evidence (a test or lint
result, the commit, command output), and What is left — so a fresh session resumes from
`bd show <id>` alone.

A `--commit` ref is resolved through `git rev-parse` to the full 40-character lowercase SHA before
recording, because `bd provenance record --ref-kind git-sha` refuses an abbreviated one; a ref that
does not resolve records nothing. Transient database failures — `failed to open database ...
context canceled`, the shape two concurrent writers produce on embeddeddolt — are retried with
bounded backoff, each retry re-reads the bead first so a write that landed before its call reported
failure is never duplicated, and no call holds the database across a long operation. Recording is
idempotent for one writer: the entry carries a fingerprint of its own content, so a repeated fire
appends nothing. Two concurrent fires of one transition can each append — `bd note` has no
conditional append — so the pipeline fires each transition from one worker.

`run-pipeline-stage` and `ralph` now call that script at every stage transition, and no shipped
skill, agent, or stage template writes a per-parent log file or a rendered progress view any more.
Ralph's log polling, its `state.json` `logLine` bookmark, and both wake sections' log-flush
procedure go with them: progress is read from the bead (`bd show`, `bd provenance log`), which is
the record the worker writes directly.
