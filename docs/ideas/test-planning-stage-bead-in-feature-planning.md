# Idea: Test-planning stage bead in feature planning

## Status
Absorbed into bead `agnt-ctx-rig0` (2026-09-22) — the verification beads in that design's
design stage generalise this idea's provable-outcome / completion-criterion motivation. Not a
standalone bead.

## Created
2026-09-03

## Problem
Tests get under-planned: features are split into beads around implementation
(code, verify, review) but nobody plans *what* needs testing or *how we know
it's done* before the work starts. Verification ends up ad hoc — a verify
stage runs whatever tests exist rather than the tests the feature actually
needs.

## Who benefits
- The agent running the pipeline (ralph / run-pipeline-stage) — has an explicit
  test plan to execute against instead of improvising a verify pass.
- The human reviewer — a stated definition of done for testing makes the PR
  gate checkable ("did the planned tests land?").
- The feature itself — testability becomes a planning output, not an accident.

## Proposed outcome
When a feature is planned, the planning phase also produces a
test/verification planning stage bead: what behaviour to test, at what level
(unit/integration/e2e), key cases and edge cases, and an explicit completion
criterion — the answer to "how do we know it's done?" The bead sits between
feature planning and implementation, so test planning happens once at plan
time rather than being rediscovered per-task.

## Validity check
- Evidence we already have: verify-stage chores exist today but run generic
  checks (`playbooks/verify.md`, `run-pipeline-stage`); nothing at plan time
  defines the feature's test surface or a testing definition of done — PR
  reviews have to reconstruct what should have been tested.
- Riskiest assumption: a test-plan bead is actually useful to the executing
  agent and isn't just ceremony that duplicates what the code bead already
  implies ("write tests that cover this feature"). Cheap to validate: try it
  on one feature and judge whether the verify stage runs a materially better
  test pass.
- What would invalidate this idea: if RALPH's verify stage already produces
  adequate coverage decisions from the playbook alone, the extra bead adds
  overhead without changing outcomes.

## Constraints
- Pipeline shape is fixed by the existing bead/pipeline contract
  (create-task chores, ralph stage dispatch) — the new bead type must slot in
  without a pipeline redesign.
- No new runtime for test execution — the bead plans; existing verify tooling
  executes.
- Must stay lightweight: test planning for its own sake is the failure mode.

## Next validation step
Run a two-feature pilot: for the next two planned features, hand-write a
test/verification plan bead (without wiring it into the pipeline) and compare
the resulting verify passes against a control feature planned the current
way. If the planned features demonstrably get better test coverage, wire the
bead type into the planning skill.

## Notes
- User framing: "planning, then test/verification planning — how do we know
  it's done?" The completion criterion is the heart of the idea, not the bead
  itself.
- Priority: medium — next planning-skill iteration, not blocking current work.
- The definition-of-done answer could eventually feed the HITL PR gate
  (reviewer checks planned-tests-vs-landed-tests).