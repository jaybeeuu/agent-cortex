---
"@jaybeeuu/agent-cortex": minor
---

Add guppi's **interrupt protocol**: checkpoint, record, rewind, resume. guppi takes a resume point at
the last clean boundary, records the interruption as the bead type its content implies — a meeting
note becomes an idea or task bead through `record-idea`/`create-task`, PR feedback for ralph becomes a
task bead through `create-task` carrying the pull request's reference (with a `handoff` document
through `hitl-collab` when a human must act on it, and no peer message at all, because ralph reads the
bead from the tracker), a Slack todo becomes a task bead through `create-task`, and a question only a
human can answer becomes an `execution:hitl` decision bead — rewinds to the checkpoint, and resumes
with one sentence naming the task and the recorded bead. The record completes before the rewind, so a
failed record is never lost; a failed rewind continues in the current context and says so rather than
silently carrying the interruption. Nothing is written to a scratch file and no branch is deleted —
the abandoned branch is the audit trail. The rewind mechanism is forked through the existing
`interrupt_rewind` token row (`interrupt_resume` on pi, `/rewind` on claude), so the four-step prose
is byte-identical across harnesses; `test/guppi-interrupt-render.test.mjs` stages both installs to
prove it.
