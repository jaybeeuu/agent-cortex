# Idea: Unify the ticket and task decomposition workflows

## Status
Backlog idea (not implementation-ready)

## Created
2026-10-13

## Problem
The planning skills assume a fixed split between tickets and tasks, and implement
decomposition in three places that do not agree:

- `prd-to-tasks` slices a PRD into epics and task beads, then expands each task through
  `create-task` into pipeline chore beads for ralph.
- `spec-to-tickets` slices a spec into a ticket map, drafts bodies, and creates tickets in
  a tracker (Jira, GitLab, GitHub, or beads).
- `plan` Phase 2 re-implements the slicing logic inline rather than delegating.

There is no model for a ticket that itself needs breaking into tasks, and no single place
that owns decomposition. Which skill to use depends on the tracker rather than on the work.

## Who benefits
The author, and any agent running the planning skills. One decomposition path replaces
three overlapping ones, and a ticket in any tracker can be created and then broken into
tasks without switching skills.

## Proposed outcome
A single coherent model in which a ticket — in any tracker, including beads — can be
created and then decomposed into tasks, with the tracker acting as an adapter rather than
defining a separate skill. The exact shape is deliberately undecided; this record captures
the problem, not a design.

## Validity check
- Evidence we already have: three implementations of spec-to-units slicing (`plan` Phase 2
  inline, `prd-to-tasks`, `spec-to-tickets`); `prd-to-tasks` has eight dependents plus a
  generated agent file; the only substantive difference between the two decomposition
  skills is the creation contract — `create-task` expands AFK tasks into ralph's chore
  tree, while `spec-to-tickets` uses a generic tracker adapter.
- Riskiest assumption: not yet identified — this needs a thinking-through pass. Candidates
  to test: (a) the ticket/task split can be unified without losing ralph's execution
  contract; (b) the refactor is affordable given its blast radius; (c) the duplication is
  causing enough harm to justify it at all.
- What would invalidate this idea: if ralph's requirements — chore-tree expansion via
  `create-chores.mjs`/`pipeline.json`, epic branches, AFK/HITL classification — cannot be
  expressed as a tracker adapter behind one slicing skill, then the split is load-bearing
  and should stay. It would also be invalidated if the duplication never produces concrete
  drift.

## Constraints
- Ralph's execution contract is fixed and must keep working: chore expansion, the epic PR
  flow, and AFK/HITL classification.
- Open beads `agnt-ctx-s5xd.4` and `agnt-ctx-s5xd.4.4` are already rewriting
  `prd-to-tasks` and `plan`'s tagging for the `execution:` label model. Any refactor has to
  land after that epic or it will collide.
- Skills target ~150 lines, so a unified decomposition skill would need its tracker
  adapters and formats split into support files.

## Next validation step
Once the s5xd two-axis epic lands, enumerate exactly what `create-task` and ralph require
from a decomposition — classification, chore tree, epic hierarchy, labels — and test
whether each can be expressed as a tracker adapter behind one slicing skill. That is the
cheapest step that would firm up or kill the idea.

## Notes
- The open question at the heart of it: are "ticket" and "task" the same thing at different
  granularities, or genuinely different things? Related: is a ticket a ralph task, or
  something a ralph task is created from?
- Priority P3 by the author's call — it blocks other planning work rather than being
  polish.
- Filed during the `write-a-ticket` / `spec-to-tickets` work (bead `agnt-ctx-vgzj`), where
  the overlap first became concrete.
