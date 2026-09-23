# Idea: record-idea-implementation-questions

## Status
Folded into bead `agnt-ctx-s5xd.2.2` (2026-09-22) — the `record-idea` bead rewrite absorbs these
questions and the `## Design so far / provenance` section. Not a standalone bead.

## Created
2026-08-30

## Problem
The `record-idea` interview captures *why / how / when / priority* but not enough about the
implementation to give a recorded idea a sufficient shape. Ideas often arrive with backstory —
they've come from somewhere (a previous session, a conversation, a pain point in another
skill), they carry partial design thoughts or ruled-out approaches, and a bare title plus
"how we might do it" loses that detail. The record ends up thinner than the thinking that
produced it.

## Who benefits
Anyone reading an idea record later (the author, plan agents, ralph) — a record with an
implementation shape and its provenance is far easier to pick up than one that restates the
title. The author also saves re-explaining context: capture it once, at the source.

## Proposed outcome
Extend the `record-idea` interview and template:

1. **A fixed, short set of implementation questions** baked into the interview — roughly:
   - Rough mechanism: what shape would the implementation take (skill / extension / agent /
     script / convention)?
   - Known constraints or tradeoffs already spotted?
   - Existing design thoughts: anything already designed, sketched, or ruled out?
2. **A couple of adaptive follow-ups** when the fixed answers open a thread worth pulling —
   but explicitly bounded: this is capture, not solutionising. The moment the conversation
   drifts into implementation detail, stop and record.
3. **New template section** — e.g. `## Design so far / provenance` — where pre-existing
   thoughts (where the idea came from, partial designs, discarded options) are recorded so
   they survive under the title instead of being lost.

## Validity check
- Evidence we already have: the last few recorded ideas (self-flushing-session,
  state-in-beads-not-md) arrived with real backstory — provenance and pre-existing design
  choices were captured only because the session happened to cover them; the skill itself
  doesn't ask. The existing interview already draws out why/how/when/priority, so adding two
  more question groups is a small, natural extension.
- Riskiest assumption: the balance between "capture shape" and "solutionising session".
  Too many follow-ups and the interview bloats; the record becomes a design doc and the
  author resists using the skill. Needs an explicit off-ramp ("enough — record it").
- What would invalidate this idea: if the fixed questions mostly produce "unknown / not
  thought about yet" answers — then the added friction isn't buying anything and the template
  section stays empty. Watch whether follow-ups actually surface design thoughts in practice.

## Constraints
- Keep the interview fast: a couple of questions, a couple of bounded follow-ups, then record.
- Must not turn into a solutionising session — capture existing thinking, don't generate new
  design.
- Lands naturally alongside the `record-ideas-as-beads` rewrite of `record-idea` (bead-based
  creation): this skill change rides that migration rather than forking it.

## Next validation step
Fold the fixed questions + `## Design so far / provenance` section into `record-idea` next
time it's exercised (or during the record-ideas-as-beads rewrite), then check the next few
records: did they capture backstory that would otherwise have been lost, and did the
interview stay short?

## Notes
Recorded 2026-08-30 (P2). Applies to the current file-based flow and the future bead-based
flow (`record-ideas-as-beads` plans interview → `bd create --notes ...`; the provenance
section maps into `--notes` with markers). Explicitly a capture improvement, not a design
step — the line is: record what the user already thinks, don't co-design with them.