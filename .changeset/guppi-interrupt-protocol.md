---
"@jaybeeuu/agent-cortex": minor
---

Add guppi's **interrupt protocol**: checkpoint, record, rewind, resume. guppi takes a resume point at
the last clean boundary, records the interruption as the bead type its content implies — a meeting
note becomes an idea or task bead through `record-idea`/`create-task`, PR feedback for ralph becomes a
`handoff` message, a Slack todo becomes a task bead (a `classify-bead` HITL decision when only a human
can answer it) — rewinds to the checkpoint, and resumes with one sentence naming the task and the
recorded bead. The record completes before the rewind, so a failed record is never lost; a failed
rewind continues in the current context and says so rather than silently carrying the interruption.
Nothing is written to a scratch file and no branch is deleted — the abandoned branch is the audit
trail. The rewind mechanism is forked through the existing `interrupt_rewind` token row
(`interrupt_resume` on pi, `/rewind` on claude), so the four-step prose is byte-identical across
harnesses; `test/guppi-interrupt-render.test.mjs` stages both installs to prove it.
