---
name: improve-codebase-architecture
description: Explore a codebase to surface architectural friction and turn it into module-deepening refactors that improve testability and AI-navigability. Use when the user wants to improve the architecture, find refactoring opportunities, consolidate tightly-coupled modules, or says a codebase is hard to navigate.
---

# Improve Codebase Architecture

Explore a codebase the way an AI would, surface where understanding requires bouncing between many small files, and propose module-deepening refactors as executable beads.

A **deep module** (John Ousterhout, "A Philosophy of Software Design") has a small interface hiding a large implementation. Deep modules are more testable, more AI-navigable, and testable at the boundary instead of inside the seams.

## When to use

- The user wants to improve the architecture or find refactoring opportunities.
- The user asks to consolidate tightly-coupled modules or "make this more testable".
- The user says a codebase is "hard to navigate" or hard for AI to work with.

## When NOT to use

- The refactor target is decided and only an implementation plan is missing — run `request-refactor-plan` instead.
- The task is comparing two specific options with trade-offs — run `technical-direction` instead.
- The user wants interface shapes for one known module — run `design-an-interface` instead.
- The work is a new feature needing scoping — run `plan` or `write-a-prd` instead.

## Workflow

1. **Explore the codebase.** Navigate with Bash, Grep, Read, and Glob, and note where you experience friction: concepts spread across many small files, interfaces nearly as complex as their implementations, pure functions extracted for testability while bugs hide in their call sites, tight coupling creating integration risk, or untested hard-to-test areas. The friction you encounter is the signal — record it as you go.

2. **Present candidates.** Give a numbered list of deepening opportunities. For each, show the cluster of modules involved, why they are coupled (shared types, call patterns, co-ownership of a concept), the dependency category (see [REFERENCE.md](REFERENCE.md)), and the test impact. Do not propose interfaces yet — ask "Which of these would you like to explore?"

3. **User picks a candidate.**

4. **Frame the problem space.** Before designing anything, write a user-facing frame for the chosen candidate: the constraints any new interface must satisfy, the dependencies it must rely on, and a rough illustrative code sketch. A sketch is not a proposal — it grounds the constraints. Show the frame and proceed immediately; the user reads it while you design.

5. **Design multiple interfaces.** Cycle through radically different constraints, writing each design out fully before the next:

   1. **Minimal** — aim for 1-3 entry points; what complexity hides behind a small surface?
   2. **Flexible** — open for future use cases and extension.
   3. **Caller-optimised** — make the most common calling pattern trivial.
   4. **Ports & adapters** (if cross-boundary deps) — isolate side effects from pure logic.

   For each design, output the interface signature, a usage example, the complexity it hides, the dependency strategy (see [REFERENCE.md](REFERENCE.md)), and its trade-offs. Present designs sequentially, then compare them in prose and give your own recommendation — propose a hybrid where elements combine well. The user wants a strong read, not a menu.

6. **User picks an interface** (or accepts the recommendation).

7. **Create the refactor bead.** Run the `create-task` skill with a concise title, the description from the template in [REFERENCE.md](REFERENCE.md), and priority P2. Always use `create-task` — never `bd create` directly — because it classifies the bead and expands AFK work into pipeline stages ralph can execute. Do not ask the user to review before creating; share the bead ID.

## Red Flags

- Red flag: proposing an interface during candidate presentation — it biases which problem space the user picks.
- Red flag: skipping the problem-space frame to save a step — designs without stated constraints drift.
- Red flag: designing a single interface — the first design is rarely the strongest ("Design It Twice").
- Red flag: filing the bead with `bd create` instead of `create-task` — the pipeline expansion is skipped.
- Red flag: judging designs by implementation effort — a deeper interface often looks harder to build.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I already know the best interface" | The first design is rarely the best. Generating alternatives is where the comparison insight comes from. |
| "The candidates are obvious — list them quickly" | The presentation is what lets the user pick deliberately; short-circuiting it forces a guess. |
| "The problem space is clear enough — skip the frame" | An unframed design session produces interfaces that satisfy imagined constraints. |
| "It's one task — `bd create` is fine" | `create-task` classifies the bead and expands pipeline stages; bypassing it strands the work for ralph. |

## Philosophy / rationale

- **Deep modules beat shallow ones.** A small interface hiding real complexity is easier to learn, test, and navigate; a shallow module forces callers to know as much as the implementation does.
- **An AI's navigation friction is the signal.** Wherever exploration requires bouncing between files, a missing seam or a shallow module is hiding — the explorer's pain maps directly to where a deep module is needed.
- **Replace, don't layer tests.** Once boundary tests exist at the deepened interface, the old shallow-module tests are waste — tests should assert observable outcomes through the public interface, not internal state.
- **Candidate-first, interface-later.** Interfaces proposed before the user picks a problem space pre-commit the exploration to a shape they did not choose.

## Phase-gate checklists

- [ ] Phase 1 complete: exploration done and candidates presented without proposing interfaces
- [ ] Phase 2 complete: problem space framed and shown to the user before any design work
- [ ] Phase 3 complete: at least two radically different designs presented and compared, with a recommendation given
- [ ] Phase 4 complete: refactor bead created via `create-task` and the bead ID reported

## Cross-skill references

- Run `design-an-interface` at step 5 for a guided parallel sub-agent design flow.
- Run `create-task` at step 7 to file the refactor bead.
- Run `grill-with-docs` when the deepened module's terminology is unsettled — interface names should match the ubiquitous language.

## Examples

Input: "This codebase is hard to navigate — can you make it more testable?"
Output: numbered deepening candidates (cluster, coupling, dependency category, test impact) → chosen candidate → problem-space frame → at least two interface designs with a recommendation → a P2 refactor bead ID from `create-task`, with the bead description following the template in [REFERENCE.md](REFERENCE.md).

## Verification checklist

- [ ] Friction notes recorded during exploration
- [ ] Candidates presented with cluster, coupling, dependency category, and test impact — no interfaces proposed
- [ ] Problem-space frame shown to the user before any design work
- [ ] At least two radically different designs, each with signature, usage example, hidden complexity, dependency strategy, and trade-offs
- [ ] Recommendation given in prose, with a hybrid proposed where elements combine well
- [ ] Refactor bead created via `create-task` at P2 using the REFERENCE.md description template
- [ ] Bead ID reported and no review gate imposed before creation
- [ ] No unrelated areas explored or refactors proposed outside the chosen candidate