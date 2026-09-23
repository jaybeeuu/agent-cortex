# Idea: Test data creation helpers

## Status
Backlog idea (not implementation-ready) — priority P2 (moderate)

## Created
2026-09-14

## Problem
Agents writing tests reach for test data the lazy way, in three shapes:

1. **Shared module-scope objects used as fixtures.** Because the object is built once at
   top-level scope and reused, every test mutates the same instance — state leaks between
   tests, and a passing test can depend on the order in which others ran. Failures are
   order-dependent and hard to reproduce in isolation.
2. **Data built outside the test rather than inline.** The reader — and the next agent — must
   scroll away from the assertion to find what the input actually was, so the test stops
   reading as an example of the behaviour under test.
3. **No small configurable helper.** Instead of a factory with sensible defaults and an
   overrides argument, each test re-spells the entire literal. One field change means editing
   every call site, and the tests silently drift apart from one another.

Net effect: tests that are annoying to read, annoying to change, and occasionally lie. The
cost is paid again on every subsequent edit.

## Who benefits
Everyone who reads or changes the suite: the author reviewing a diff, the reviewer agent
auditing a PR, and later agents picking the code up cold. It also cuts churn in ralph pipeline
runs, where agents write tests unattended and nobody corrects a sloppy fixture habit in the
moment. Test authors write less boilerplate; reviewers have less to query.

## Proposed outcome
Skill-only guidance (no shipped helper code) telling the agent how to create test data:

- **Build data inline in the test** (or in a helper called from it), so the test body shows the
  shape of its own input.
- **No shared mutable top-level fixture.** If data must be reused, it is produced fresh per
  test by a function — a factory, not a constant. Module-scope constants are acceptable only
  when genuinely immutable and read-only.
- **Prefer a small configurable helper** — a factory taking partial overrides with defaults for
  the rest — over repeated full literals. Build the helper only when reuse justifies it; a
  single test's data stays a plain inline object.
- **Name and locate the helper conventionally** so the next agent finds it (colocated with the
  tests, named for what it builds).

Landing: the rule belongs in `style-tests`, the skill that already governs test-writing
conventions, with `tdd` and `engineering` pointing at it so the habit lands at authoring time.
Per the repo's keep-skill-bodies-small convention it is a red-flag row plus a checklist item,
not a new essay.

## Validity check
- Evidence we already have: the pattern is observed repeatedly in agent-authored tests
  (module-scope fixtures mutated across tests, full literals duplicated per test); `style-tests`
  already asserts behaviour-over-structure and mock discipline, so a data-construction rule fits
  its existing remit without new philosophy; and the sibling idea `ban-content-assertion-tests`
  shows this class of test-quality gap is real and gets fixed the same way — skill-only, red flag
  plus checklist item. The repo already ships skills governing how tests are written, so there is
  a known enforcement point and no new mechanism to invent.
- Riskiest assumption: that a prose rule actually changes agent behaviour. The content-assertion
  idea rests on the same assumption; if agents keep reaching for module-scope fixtures after the
  rule lands, the fix is a review gate rather than more wording. Second-riskiest: that "no shared
  top-level fixture" is not overly absolute — a genuinely immutable shared constant (a frozen
  canonical example) is fine, so the wording must target mutability and per-test freshness, not
  top-level scope by itself.
- What would invalidate this idea: finding that the real cause is not agent habit but a missing
  convention in the target projects (nowhere for a helper to live, so inline literals are the only
  option), or that a project's test framework already ships builders the agent simply fails to
  find — either would move the fix to discoverability or enforcement rather than a style rule.

## Constraints
- **Skill-only.** No helper library shipped from this plugin — each project owns its factories.
- Keep `style-tests` at ~100 lines: add a red-flag row and a verification-checklist item; do not
  expand the skill's philosophy.
- Do not ban top-level constants outright — the rule targets mutable shared state and per-test
  freshness.
- Small scope: no pipeline changes beyond pointing `tdd`/`engineering` at the rule.

## Next validation step
Before implementing, grep the agent-authored tests in this repo (and one or two target projects)
for module-scope fixture objects versus inline/per-test construction, to confirm the pattern is as
frequent as the anecdote suggests and to capture two or three concrete before/after examples. If
it is real, land the red-flag row in `style-tests`, add the pointer lines in `tdd`/`engineering`,
then check the next ralph run's tests for it.

## Notes
Recorded 2026-09-14 (P2). Interview was deliberately short — this is a capture, not a spec. Timing
signal: "it's annoying" — a recurring, low-severity papercut that costs a little on every test
edit rather than a project-breaking defect, hence P2 rather than the P1 carried by adjacent
content-assertion work. Stance locked in interview: skill-only guidance, no shipped helper code;
the fix is teaching the agent the pattern, not providing a library. Related:
`ban-content-assertion-tests.md` (same enforcement point, same shape of fix),
`test-planning-stage-bead-in-feature-planning.md` (test-stage quality in the pipeline).
