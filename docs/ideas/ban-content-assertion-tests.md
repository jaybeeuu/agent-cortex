# Idea: ban-content-assertion-tests

## Status
Backlog idea (not implementation-ready) — priority P1 (high)

## Created
2026-08-30

## Problem
Ralph pipeline chores write tests that assert on static content — config files, markdown,
terraform files, snapshots of files that never change behaviour. These tests do not prove
behaviour; they assert content. They are irrelevant, unhelpful, and a straight waste of
tokens: they take time to write and run, break on unrelated edits, and add maintenance
weight for zero behavioural signal.

## Who benefits
Every ralph-managed project. Chores stop burning tokens on meaningless tests, PRs stop
carrying noise tests, and the suite stays a genuine behavioural signal instead of a content
inventory. Reviewers (author + agents) get less churn to triage.

## Proposed outcome
A blanket ban — **no carve-outs**: tests that assert static file contents (config, md, tf,
or any snapshot of static content) are never written. They prove nothing about behaviour and
belong to neither the suite nor the PR.

Landing it:
1. **`style-tests`** — add an explicit red flag (and verification-checklist item): *asserting
   static file content — config/md/tf snapshots. If the file never changes behaviour, the test
   is a content assertion, not a behaviour test.* The existing "test behaviour, not
   implementation" / "every test has a cost" principles already point here — make it explicit.
2. **`ralph` + `run-pipeline-stage`** (minimum) — the pipeline instructions should warn stage
   runners not to write content-assertion tests; a review gate checks for them.
3. **Sweep the rest** — before implementation, review tdd, engineering, and other skills for
   anything that encourages or tolerates content-assertion tests, and align them with the ban.

## Validity check
- Evidence we already have: `style-tests` already champions behaviour-over-structure and
  test-cost discipline — the red flag slots straight into its existing table without new
  philosophy. The observed trigger came from ralph runs producing such tests unprompted,
  which shows the current skills don't discourage it.
- Riskiest assumption: distinguishing "asserts static content" from legitimate integration
  tests that happen to read files (e.g. a parser's golden output). The ban must be worded to
  hit the former without chilling the latter — the line is *whether the assertion proves the
  behaviour under test*, not whether a file is read.
- What would invalidate this idea: if a case emerges where asserting file content IS the
  behaviour (a generator, a config compiler, a template renderer) and the blanket wording
  blocks a real test — the blanket ban explicitly accepts excluding those; if that carve-out
  turns out to be needed after all, the wording needs revisiting.

## Constraints
- Blanket ban, no carve-outs in the initial landing.
- Costs tokens and churn today — P1.
- Keep `style-tests` ≤ ~100 lines: add the red flag + checklist item, don't expand philosophy.
- Pipeline review gates (ralph HITL review) check for content-assertion tests before merge.

## Next validation step
When preparing for work: sweep the skills (style-tests, ralph, run-pipeline-stage, tdd,
engineering, plan) for current wording that tolerates or invites content-assertion tests;
then land the red flag in `style-tests` plus explicit warnings in the ralph skills, and
verify a subsequent ralph run stops producing them.

## Design so far / provenance
Came from watching ralph pipeline runs generate tests that merely assert the contents of
static files — e.g. config, md, and tf files — which is content-inventory, not behaviour
proof. Stance locked in interview on 2026-08-30: blanket ban (no golden-file carve-out at
initial landing); minimum skill scope = style-tests + ralph + run-pipeline-stage (+ tdd/
engineering), with a broader skill sweep during prep; priority P1.

## Notes
Recorded 2026-08-30 (P1). This is a deliberate exception to the default "write tests —
red-green-refactor" posture: not all assertions are tests of behaviour, and an assertion on
immutable content is cost without signal. The `style-tests` skill is the enforcement point;
ralph/run-pipeline-stage are where it keeps happening.