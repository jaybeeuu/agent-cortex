---
name: request-refactor-plan
description: Create a detailed refactor plan via user interview, split into tiny commits, then file it as a bead. Use when planning a refactor, writing a refactoring RFC, or splitting a refactor into safe steps.
---

# Request Refactor Plan

## When to use

- The user asks to "plan a refactor", "write a refactoring RFC", or "break this into safe incremental steps".
- A refactor is too big or risky to execute without a commit-level plan.
- You need a detailed, interview-derived implementation plan filed as a tracked task.

## When NOT to use

- Trivial one-shot edits that need no plan — make the change directly.
- Product- or feature-level planning — use `write-a-prd`.
- A refactor plan already exists — file or execute it; do not re-plan.
- An early-stage idea not ready for planning — record it with `record-idea`.

## Workflow

1. Interview the user for a long, detailed description of the problem and any potential solution ideas. Capture their words — the plan must encode the user's decisions, not your assumptions.
2. Explore the repo to verify their assertions and understand the current state of the codebase. Codebases drift, so check rather than trust.
3. Ask whether they have considered other options, and present alternatives yourself.
4. Interview the user about the implementation in detail. Make every decision the plan needs now, while context is fresh.
5. Hammer out the exact scope: what the plan will change and what it will not change.
6. Check test coverage of the affected area. If coverage is insufficient, ask what the testing plans are.
7. Break the implementation into a plan of tiny commits. Follow Martin Fowler: make each refactoring step as small as possible so you can always see the program working. Each commit must leave the codebase in a working state.
8. Invoke the `create-task` skill to file the bead, passing:
   - **title**: a concise name for the refactor
   - **description**: the refactor plan formatted with the template in `FORMAT.md`
   - **priority**: P2

   Always invoke `create-task` — never `bd create` directly. `create-task` classifies the bead and expands AFK tasks into pipeline stage beads for ralph.

## Red Flags

- Skipping the interview because the request seems clear. The interview surfaces decisions only the user knows; a plan built on assumptions will not match reality.
- Adding file paths or code snippets to the Decision Document. Implementation detail goes stale quickly and misdirects the executor.
- Planning commits too big to verify in isolation. If a step cannot leave the program visibly working, split it further.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "The user already told me what they want — the interview is unnecessary" | The interview collects decisions, not descriptions. Without it the plan is guesswork. |
| "I know this codebase — exploring again is a waste" | Codebases drift. Verifying assertions is cheap and prevents planning against stale assumptions. |
| "File paths in the decision doc make it more useful" | File paths go stale quickly. Keep decisions in the doc, paths out. |
| "This refactor is small — one or two commits will do" | Each step stays as small as possible so you can always see the program working. Small commits also keep reviews tractable. |

## Philosophy / rationale

- **Interview-first.** The plan encodes the user's decisions, made while context is fresh, not the agent's guesses.
- **Tiny commits.** Fowler's rule — each step as small as possible so you can always see the program working — makes regressions localisable and reviews tractable.
- **Decisions without paths.** A document that names files ages overnight; one that names decisions survives the implementation.

## Phase-gate checklist

- [ ] Phase 1 complete: problem and ideas captured, assertions verified in the repo.
- [ ] Phase 2 complete: alternatives discussed, scope and testing plan agreed.
- [ ] Phase 3 complete: commit plan written with every step leaving the codebase working.
- [ ] Phase 4 complete: bead filed via `create-task` with priority P2.

## Cross-skill references

- `create-task` — files the plan bead and expands it into pipeline stages. Mandatory; never call `bd create` directly.
- `write-a-prd` — product-level planning that is not a code refactor.
- `record-idea` — early-stage refactor ideas not ready for a full plan.

## Examples

Input: "I want to refactor how config validation is wired in this repo"
Output: a P2 bead filed via `create-task` whose description follows the `FORMAT.md` template: Problem Statement, Solution, a commit-by-commit plan (each leaving the repo working), a Decision Document with decisions only, Testing Decisions, and Out of Scope.

## Verification checklist

- [ ] Interview covered problem, solution ideas, alternatives, and implementation details.
- [ ] User's assertions verified against the actual codebase; nothing assumed unverified.
- [ ] Scope agreed: what will change and what will not.
- [ ] Test coverage assessed; testing plan recorded when coverage is insufficient.
- [ ] Commit plan written with every commit leaving the codebase working.
- [ ] Decision Document contains decisions only — no file paths or code snippets.
- [ ] Bead filed via `create-task` with concise title, `FORMAT.md`-formatted description, priority P2.