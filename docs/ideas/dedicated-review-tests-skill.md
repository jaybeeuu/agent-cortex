# Idea: Dedicated review-tests skill

## Status
Backlog idea (not implementation-ready) — priority P2 (moderate), timing: follows `agnt-ctx-h9gt`

## Created
2026-10-06

## Problem
Test review has no home of its own in the ralph pipeline. The review stage invokes
`review-security` for a dedicated security pass, then falls back to `style-code` and
`style-tests` for everything else. `style-tests` is a *writing* skill — it states conventions
before tests are authored — so a reviewer reading it has to invert authoring guidance into
review findings. The result is that test defects are caught by whatever the reviewer happens to
notice rather than by an explicit checklist, and each new class of defect (the content-assertion
ban being the first) has to be bolted onto the review template individually.

## Who benefits
- **The author**, who stops triaging test defects that a structured review should have caught.
- **Ralph stage runners**, who get an explicit finding checklist instead of inferring one from a
  writing-conventions skill.
- **Future skill authors**, who get one place to add a test-review rule rather than editing the
  review template, the review playbook, and `style-tests` in lockstep.

## Proposed outcome
A `review-tests` skill — a peer to `review-security` — that specifies what a reviewer checks in
a test suite: assertion quality (does each assertion prove the behaviour under test),
mock discipline (boundaries only, never internals), test-data construction (vital data inline,
fresh per test, no shared mutable fixtures), determinism (no sleeps, no real clocks, every async
interaction awaited), and coverage gaps against the task's stated behaviours.

Broad scope, narrow use: the skill is generic test-review guidance, invoked as a stage step by
the ralph review playbook (and available to a human reviewer or a `git-workflow` PR review).
Once it exists, the content-assertion check added by `agnt-ctx-h9gt` becomes one row inside it
rather than a standing instruction in the review template.

## Validity check
- Evidence we already have: the review stage already delegates to skills for every other
  concern (`review-security` for security, `style-code` for code shape, `style-documentation`
  for docs) — test review is the gap in an otherwise uniform pattern. The content-assertion
  ban was bolted onto the review template precisely because no skill owned test review.
- Riskiest assumption: that a *review* checklist is meaningfully different from `style-tests`
  read critically. If a reviewer can derive the findings from the existing authoring skill with
  no loss, this becomes a second statement of the same rules — exactly the two-homes problem
  `agnt-ctx-h9gt` avoids by keeping `style-tests` canonical.
- What would invalidate this idea: if `agnt-ctx-h9gt`'s review-gate change turns out to be
  sufficient — if the review stage, with the content-assertion check in hand, stops missing
  test defects — then the dedicated skill earns nothing and should be dropped.

## Constraints
- `style-tests` stays the canonical statement of test conventions; `review-tests` must cite it
  and add only the reviewer's framing, or the two will drift.
- Must not duplicate `review-security`'s ground or re-run the test suite (that is the verify
  stage's job).
- Invoked from the review playbook, so it must be cheap to load — no expansion of the review
  stage's token budget beyond one skill read.
- Follows `agnt-ctx-h9gt`; the content-assertion rule must not be restated in a second place
  until this skill exists to hold it.

## Next validation step
After `agnt-ctx-h9gt` has run through the pipeline at least once, collect the test-related
findings its review stage actually produces across a few PRs. If reviewers keep requesting
changes on test grounds that the template does not name, that list is the skill's first
checklist and the idea is confirmed; if the template covers them, drop the idea.

## Notes
Floated by the author on 2026-10-06 while scoping `agnt-ctx-h9gt`. Stance locked in the
interview: broad scope (generic test review, not a pipeline-specific gate), used in the ralph
pipeline, priority P2 with the trigger being `agnt-ctx-h9gt`'s real-world review findings.
Deliberately kept as an idea rather than folded into `agnt-ctx-h9gt` so it passes the same
validity check as every other backlog entry.
