# Idea: task-session-context

## Status
Backlog idea (not implementation-ready)

## Created
2026-08-25

## Problem
Coding sessions accumulate context turn by turn: every question, every tool call, every
tangent stays in the window until it's manually compacted or the session is restarted. Keeping
the context small and relevant is an active management burden — the author has to notice the
bloat, decide what matters, and intervene. Long conversations either burn tokens or require
frequent manual resets that drop useful memory.

## Who benefits
The author, daily. Removing context management from the loop means sessions stay small and
focused no matter how long the overall thread runs. It also produces a durable, reviewable log
of work: each task's bead + summary memory is an audit trail of what was done and why.

## Proposed outcome
A workflow organised around **tasks** instead of sessions. Whenever the user does something
discrete — asks a new question, records an idea, fleshes out a piece of work — it **begins a
task**:

1. **Task = blank session with memory context.** The task starts a fresh, self-contained
   session. It does NOT get every turn and tool call of the parent conversation — only access
   to the accumulated **memories** of what came before (a summary/compressed view, not the raw
   transcript).
2. **Self-contained execution.** The task works on its own: it takes action, and **records
   memories along the way** as it produces outcomes.
3. **Single summary memory on completion.** The last thing a task does is write one summary
   memory capturing its outcome. These memories are additive — the running memory store grows as
   tasks complete.
4. **Fresh session continues the thread.** Once the task completes, a new session starts with
   access to the memories — including the new summary — so to the user it feels like one
   continuous thread, but each underlying session stays small.

**Ties into beads (bd):** "the completion of a bead is the completion of a task". A bead becomes
the log of work completed: the task's outcome is recorded on/with the bead, the fresh session
starts, and the bead is accompanied by **referential memory** (a pointer/memory entry that links
the outcome to the bead). So the bead doubles as the durable record AND the context-boundary
marker: starting a bead is the trigger for task-session separation.

**The bead is the artifact — the session is disposable.** Once a task is complete, the whole
conversation context is no longer needed; the bead is the artifact. The current conversation is
the live example: recording this idea is a task, and when it's done the transcript of every turn
and tool call can be discarded — what remains is the record plus its summary/referential memory.
This is the load-bearing philosophical point of the idea: sessions exist to serve tasks, not the
other way around. Context is an implementation detail of a single task; the bead is the durable
unit of history.

The mechanism likely needs: a memory store (per-project, e.g. under `~/.pi/agent-cortex/` or a
records convention), a session-scoping rule (what memories a fresh task session is seeded with),
the summary-writing step, and the bead ↔ memory linkage.

## Validity check
- Evidence we already have: the repo already runs on beads as the unit of work (bd), and the
  ralph pipeline already treats beads as self-contained executable units — so task-per-bead
  separation is a natural extension of an existing pattern. Existing ideas
  (`record-ideas-as-beads`, `pi-task-memory`, `extension-manifests`) all push in the direction of
  making agent-cortex the declared, memory-rich source of truth.
- Riskiest assumption: that a fresh session seeded with *memories only* (no raw transcript) is
  sufficient context for a task — the compression of a conversation into memories must not lose
  the specifics a task needs. Also: whether the harness (pi/Claude) even supports programmatic
  session spawning with a seed context cleanly enough for this to feel seamless.
- What would invalidate this idea: if memory-as-context proves lossy in a way that keeps tasks
  mis-executing (then the blank-session model needs the raw transcript after all, defeating the
  point); or if the session boundary machinery (start/stop/spawn with seed) fights the harness.

## Constraints
- Sessions must stay small — this is the whole point; memory is the interface, not the transcript.
- Memories are additive and durable; the summary memory is the handoff contract between tasks.
- The bead is the work log AND the context boundary: no task completion without its summary
  memory and bead record.
- Must not break the existing task loops (ralph pipeline stages, HITL handoffs) — it should
  compose with them, not fork them.

## Next validation step
Flesh-out session (proposed by the author): nail down the trigger rules (what counts as "begin a
task"), the memory store schema and what a "memory" is vs a summary, how a fresh session gets
seeded, and how the bead carries the summary + referential memory. Then a spike: one task
completing with summary → fresh session seeded → verify the thread feels continuous.

## Notes
Recorded 2026-08-25. The author explicitly wants to flesh this out later — this record captures
the working concept. It connects several existing ideas: `record-ideas-as-beads` (beads as the
unit of everything), `pi-task-memory` (memory as a first-class mechanism), and
`subagent-visibility` (visibility into what task sessions do).