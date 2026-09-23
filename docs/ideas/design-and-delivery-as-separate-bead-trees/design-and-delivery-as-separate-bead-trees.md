# Idea: Design and delivery as separate bead trees

## Status
Recorded as bead `agnt-ctx-rig0` (2026-09-22) — awaiting `plan`. Absorbs
`test-planning-stage-bead-in-feature-planning.md`.

## Created
2026-09-03

## Problem
Today one bead tree mixes intent with execution: a feature is decomposed
straight into delivery chores, so the *design* — what the feature is, its
sub-components, and how each part is *proven to work* — never exists as a
first-class structure. Verification degrades to per-chore verify passes that
drift with implementation, and nothing asks "what is the provable outcome of
this feature?" up front.

## Who benefits
- Planning agents (plan/prd-to-tasks) — design and verification get explicit
  structure instead of being implicit in delivery chores.
- Ralph / run-pipeline-stage — delivery work runs against a design tree it
  doesn't need to understand; closure is mechanical.
- The human reviewer — provable outcomes per feature give the PR gate a
  checkable "how do we know it's worked?" criterion.
- The codebase — delivery slices can be minimal (no building a whole domain
  service to ship a slice), decoupled from design completeness.

## Proposed outcome
Two first-class, linked bead trees in the tracker:

1. **Design tree** — an epic links to the features below it; a feature may
   nest further features/sub-components. Below each feature sit its
   **verification beads**: a demonstrable set that proves the design —
   "explicitly, what is the provable outcome of that feature? how do we know
   it's worked?" Verification is *part of the design stage*, not an
   afterthought of delivery.
2. **Delivery tree** — a separate structure of slices actually taken to
   delivery. Delivery slices deliberately differ from design slices (you may
   not need to build an entire domain service to deliver a slice of
   functionality). Delivery links to design but is not the same as design:
   each design and verification element is completed *by* a delivery bead,
   but the mapping is not 1-to-1 (one delivery slice can complete several
   design elements; one design element may need several delivery beads).

Mechanics: one tracker, beads typed `design` / `verification` / `delivery`,
plus a link class meaning "completes / is completed by" alongside today's
"depends on". Ralph's contract shrinks: it does not need to understand the
design tree any more than it already does — it can close a design bead when
all delivery beads linked to it are completed.

## Validity check
- Evidence we already have: the pipeline restructures around stages
  (create-task chores, ralph dispatch) tellingly reworked across #123/#124 —
  verification keeps needing re-planning per delivery; the companion idea
  "Test-planning stage bead in feature planning" independently converged on
  the same "provable outcome / how do we know it's done" question, which
  suggests a real structural gap, not a one-off itch.
- Riskiest assumption: the double tree pays for itself — i.e. delivery slices
  are *often enough* genuinely different from design slices, so the second
  tree earns its bookkeeping; and bd (or a thin shim) can express typed beads
  + link classes without brittle hacks. If real workstreams map 1-to-1 most
  of the time, the extra tree is ceremony.
- What would invalidate this idea: a pilot where the delivery tree mirrors the
  design tree slice-for-slice; or where ralph's close-when-delivery-done rule
  cannot be stated mechanically because delivery beads keep spanning design
  elements unpredictably (unbounded fan-in/fan-out breaks the closure rule).

## Constraints
- One tracker, no new store: typed beads + a "completes" link class must fit
  the existing beads model and tooling (bd link CLI today only expresses
  "depends on").
- Ralph's design-tree knowledge stays at the closure rule — no design
  semantics leak into the execution pipeline.
- Restructures planning stages: a design stage (verification inside it) and a
  delivery stage, replacing the current single decomposition.
- Backwards-compatible during rollout: existing single-tree epics keep
  working while new work adopts the split.

## Next validation step
Pilot on the next new epic, without touching pipeline code: hand-draft the
design tree (features → verification beads with stated provable outcomes) and
the delivery tree as typed beads/docs, then check (a) how often delivery
slices diverge from design slices, and (b) whether every design/verification
element is closed by a mechanical all-delivery-beads-done rule. Also
inventory bd's link/type/tag capabilities (bd link --help, tag support) to
size the tracker work before proposing the pipeline change.

## Notes
- User framing: "planning and design should create a tree of beads; the epic
  should be linked to the features below it; under each of those may be more
  features or sub components; then below that are the verification beads."
- "Delivery then is a separate tree — the slices of a design which are taken
  to deliver will not, and should not be the same as the design slices."
- Supersedes/absorbs the test-planning-stage-bead idea's motivation: the
  verification beads here generalise that idea's test-plan bead (provable
  outcome per feature). If this lands, fold the test-planning bead into the
  design stage rather than shipping it standalone.
- Priority: medium — next planning-skill iteration. Pipeline-wide restructure;
  do not start until the current pipeline stabilises post-#127.