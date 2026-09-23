# Idea: bead progress notes for session resumption

## Status
Recorded as bead `agnt-ctx-ul91` (2026-09-22) — awaiting `plan`. Merged with
`state-in-beads-not-md.md` into one bead state model design (this file is Part 2: WHAT the
progress trail contains).

## Created
2026-08-31

## Problem
A bead's notes field today records little until close, and agents hold all working state in
the session window. If a session is terminated mid-task, the context dies with it — a fresh
agent has to re-discover everything: what's done, what's blocked, what was tried, what was
learned. That re-discovery burns tokens on work that was already completed, and the bead gives
no way to pick up where the previous agent left off.

## Who benefits
The author (no lost momentum or re-discovery burn when sessions end), and every agent that
picks up a bead mid-flight. The notes become a recovery contract: with a full progress trail on
the bead, *any* agent — or a fresh session — can resume the thread without re-exploring.

## Proposed outcome
A prompted discipline: agents append to the bead's notes field **as they work**, capturing
whatever is needed to recreate state if the session terminated:
- **Key milestones** — stage transitions, chunks of completed work
- **Decisions and why** — including rejected options
- **Blocks** — what's stuck, and on what
- **Discoveries and gotchas** — non-obvious findings, traps, environment quirks
- **Problems solved and their solutions** — so the same discovery isn't repeated

This is a checkpoint trail, not a transcript: brief, scan-friendly, high-signal. The goal is
that a new agent can read the notes and resume with zero wasted discovery tokens.

The mechanism is prompting — skills/agent files instruct agents to update the bead's notes at
milestones (not a mechanical extension at first). It may later become a slight extension of the
session-managing agent: the session manager prompts/checks that the bead trail is current
before a session ends or flushes.

## Validity check
- Evidence we already have: `bd` supports multi-line markdown notes (`--notes`); ralph stages
  already transition beads through the pipeline, so milestone points exist to hook into;
  `state-in-beads-not-md` establishes bead fields as the home for this state.
- Riskiest assumption: agents actually keep the trail updated under prompting alone — without a
  mechanical check, discipline may lapse, and the trail rots. The extension shape (session agent
  checks the trail is current pre-flush/close) is the likely fix, but that's a second step.
- What would invalidate this idea: if notes grow into a transcript (cost + noise) instead of a
  checkpoint trail; or if resumption needs more than notes (e.g. a scratch file of raw state)
  anyway — then notes alone don't satisfy recovery.

## Constraints
- **Checkpoint trail, not transcript** — brief and scan-friendly; verbosity defeats the purpose.
- Prompting discipline first; a mechanism (session-agent check/extension) is the later step.
- Must not slow the ralph/run-pipeline-stage loops — the note write is a milestone action, not
  a per-tool-call log.
- Beads stay the single source of truth — no new scratch files (consistent with
  `state-in-beads-not-md`).

## Next validation step
Pick one loop (run-pipeline-stage is the natural first) and add the milestone-note instruction
to its skill: update `--notes` at stage start/end, decisions, blocks, discoveries. Verify a
subsequent stage agent can resume purely from the notes (read `bd show` and continue) without
re-reading the prior agent's log.

## Notes
- Priority: **P2** — backlog, not blocking. Annoying drift, nothing broken.
- **Dependency**: this is the missing content contract for `self-flushing-session` — a flushed
  session keeps only the bead ID, so the bead must carry enough trail to re-seed. Without these
  notes, flush/resume is lossy.
- Distinct from `state-in-beads-not-md` (WHERE state lives — rule/principle) and
  `pi-task-memory` (cross-session memory store): this is the CONTENT of the bead's progress
  trail and the prompting discipline that keeps it current. Composes with all three.
- User's framing: possibly "a slight extension of the agent that manages its session" — the
  session manager prompts/verifies the trail is current before session end, rather than a new
  standalone mechanism.