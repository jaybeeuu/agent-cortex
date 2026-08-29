# Idea: subagent-visibility

## Status
Backlog idea (not implementation-ready)

## Created
2026-08-25

## Problem
The bundled `subagent` extension delegates work to separate `pi` processes with isolated
context windows. It streams output live, shows per-agent usage stats (turns, tokens, cost), and
supports abort — but after a run there's no retained record of what each subagent actually did
(files touched, decisions, blockers), and while a run is in flight there's no richer
dashboard-level view of what each agent is up to. There's also no way to influence a running
subagent: you can only watch or Ctrl+C the whole thing. For the ralph-style parallel dispatches
(up to 5 concurrent chores) this is a real blind spot.

## Who benefits
The author, whenever running parallel subagent work (ralph pipeline chores, parallel research).
A live dashboard helps during runs; persisted per-run reports turn subagent work into a
reviewable after-action record (which also complements the HITL/summary flow). Mid-run steering
reduces wasted tokens from subagents heading the wrong way and having to restart.

## Proposed outcome
Expand (or adopt, if a store extension fits) subagent tooling to give:

1. **Live dashboard** — richer TUI during runs: per-agent status (phase, current tool call,
   files touched), so you can see what each parallel subagent is doing without digging into
   streamed output.
2. **Persisted reports** — a per-run record per subagent (what it did, files changed,
   decisions, blockers), stored for after-action review. Persistence should follow the repo
   convention: write to `~/.pi/agent-cortex/`, tagged with project path for per-project slicing.
3. **Mid-run steering** — send a message to a running subagent to change its direction
   ("skip that, focus on X") rather than killing and restarting.

Decision from the interview: **evaluate the pi extension store first** — if a maintained
extension already covers dashboard + reports (and ideally steering), adopt it; otherwise expand
the bundled `subagent` extension. Building is a fallback, not the default.

## Validity check
- Evidence we already have: the bundled `subagent` extension is a working base — it already
  spawns `pi` subprocesses, streams, and collects usage data, so the hooks for a dashboard and
  reports exist in some form. The repo has a data convention (`~/.pi/agent-cortex/`, per-project
  tagging) that reports would slot into.
- Riskiest assumption: that mid-run steering is technically feasible — subagents run as separate
  `pi` processes, so steering likely needs a message channel (e.g. a FIFO / IPC pipe into the
  running process, or a PI-native way to inject input). If the process model doesn't allow input
  mid-run, the interaction half collapses to "abort and re-dispatch with corrected instruction".
- What would invalidate this idea: if store extensions are all visibility-only (no steering) and
  the process model rules out mid-run input, the remaining value is dashboard + reports only.
  Also, if subagents use private pipes that block reading live state cheaply, the dashboard may
  be constrained to what the streamer already shows.

## Constraints
- Keep it lightweight and consistent with the repo's extension conventions (no internal LLM
  calls in the extension itself).
- Should compose with ralph's parallel dispatch (up to 5 concurrent chores) without making the
  TUI unusable.
- Steering must be safe: a message is advisory input to the subagent, not a force-kill;
  abort stays available.

## Next validation step
Two-part check before building: (1) search the pi extension store for subagent/dashboard/steering
extensions and evaluate against this wishlist; (2) verify whether a running `pi` subagent
process accepts input mid-run (checked against how the subagent extension spawns processes and
whether PI exposes any IPC/input channel) — this decides whether steering is scoped in.

## Notes
Recorded 2026-08-25. Interview decisions: visibility = both live dashboard AND persisted
per-run reports; interaction = mid-run steering (not approve-gates, not pause/resume); path =
evaluate store first, fall back to expanding the bundled `subagent` extension. Complements
`unified-ci-pipeline` (pipeline visibility) and the ralph parallelism work in this repo.