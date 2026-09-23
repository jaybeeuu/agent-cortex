# Idea: self-flushing-session

## Status
Backlog idea (not implementation-ready) — priority P1 (high)

## Created
2026-08-30

## Problem
Sessions hold context far longer than needed. Every turn, tangent, and tool call stays in
the window until a human notices the bloat and compacts or resets. The opposite of the
current default: the agent should own its context lifecycle. It holds context *just long
enough* to record the immediate outcome — as a bead — and then dumps everything, keeping
only the bead ID. State is the enemy: no more than the immediately useful context is kept
at any moment.

## Who benefits
The author daily (token cost + focus — sessions never bloat, ever, regardless of how long
the overall thread runs), and every future agent that must run long-lived threads. Beads
become the entire memory surface: searchable, syncable, dependency-aware — no separate
transcript or memory file to maintain.

## Proposed outcome
A session model where:
1. **The agent decides when to flush.** No human noticing bloat and intervening — the agent
   watches for task completion and purges its own context.
2. **Hold just enough** to write the immediate outcome as a bead, then **dump all context,
   keeping the bead ID**. The ID is the only thing that survives the flush.
3. **Beads are the memories.** No separate memory store; the beads *are* the session memory.
   Progressively discovered — a fresh context pulls in relevant beads on demand (by ID/deps/
   labels) rather than exchanging the whole history every turn.
4. **A parent bead represents the session.** One session bead per conversation; the child
   memory beads (outcomes) hang under it, discovered progressively rather than loaded whole.

Flush trigger to be fleshed out at design time: *"once a task is complete — that probably
means a bead is written, but might not."* So: task completion is the event; bead-writing is
the expected (but not guaranteed) artifact of it.

## Validity check
- Evidence we already have: beads natively support parent/child hierarchy (`--parent`), labels,
  deps, search (`bd label`, `bd list`), and the ralph pipeline already treats beads as
  self-contained executable units. `task-session-context` (recorded 2026-08-25) establishes the
  "session is disposable, bead is the artifact" principle — this idea is the mechanism for it.
- Riskiest assumption: an agent deciding to purge its *own* context is self-referential —
  mid-flush failures, deciding to dump while in-flight state matters, or dumping too early
  would lose work. Also: whether the harness (pi/Copilot CLI) exposes enough session-lifecycle
  control (start/stop/seed context, hard reset mid-thread) to make the flush mechanical rather
  than prompt-instructed.
- What would invalidate this idea: if flush can't be made reliable as a mechanism (prompt-level
  "now clear your context" is fragile — the harness may not actually drop context), or if
  progressive discovery from beads proves lossy enough that flushed tasks mis-execute.

## Constraints
- State minimisation is the point: keep only what the current task needs.
- The bead ID is the only cross-flush pointer — everything else must be re-discoverable.
- Must compose with existing loops: ralph stages, HITL handoffs, record-idea flow.
- Extension vs agent is unresolved by design: an **extension** could mechanize flush + bead
  write via event hooks; an **agent** could own the session lifecycle and decide. Both recorded
  as candidate shapes — decide at design time.

## Next validation step
Design-time fleshing-out: nail the flush trigger rules, the parent-session-bead structure,
how a fresh context seeds itself (pull-by-ID vs pull-by-label), and whether pi/Copilot expose
enough lifecycle control for a mechanical flush. Then a spike: one task completing → bead
written → flush → fresh context re-seeding from the bead ID without losing the thread.

## Notes
Recorded 2026-08-30 (P1, high). Cross-linked with `task-session-context` (principle) — this
record is the sharper mechanism: autonomous flush, beads-as-memory (no separate store), parent
session bead. Also adjacent to `pi-task-memory` (progressive discovery of memories) and
`state-in-beads-not-md` (notes/state live in beads, not files) — the three records converge on
"beads are the durable unit; context is a disposable implementation detail".