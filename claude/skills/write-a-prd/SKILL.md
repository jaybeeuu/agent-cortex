---
name: write-a-prd
description: Create a PRD through user interview, codebase exploration, and module design, then file as a bead. Use when user wants to write a PRD, create a product requirements document, or plan a new feature.
---

# Write a PRD

## When to use

- The user asks to "write a PRD", wants a "product requirements document", or says "plan a new feature".
- A feature idea needs a written specification before implementation starts.
- You need a durable record of the problem, solution, user stories, and key decisions.

## When NOT to use

- The idea is not ready to build yet — use `record-idea` to capture it to the backlog.
- The output targets a human team's external tracker — use `write-a-ticket`.
- A PRD already exists and needs breaking into tasks — use `prd-to-tasks`.
- The scope is a refactor needing a safe incremental plan — use `request-refactor-plan`.

## Workflow

1. **Gather the problem statement.** Ask the user for a long, detailed description of the problem and any potential solution ideas. Ask one question at a time.
2. **Explore the codebase.** Verify the user's assertions against the repo's current state. Explore instead of asking when the answer lives in code.
3. **Interview relentlessly.** Walk down each branch of the design tree, resolving dependencies between decisions one by one, until the user's understanding and yours are identical. Every open question at this point becomes ambiguity in the PRD.
4. **Sketch the modules.** List the major modules to build or modify, actively looking for deep modules — ones that encapsulate rich behaviour behind a simple, stable interface testable in isolation. Confirm the list with the user, plus which modules they want tests written for.
5. **Write the PRD.** Render the template in `FORMAT.md` (Problem Statement, Solution, User Stories, Implementation Decisions, Testing Decisions, Out of Scope, Further Notes). Make the user-story list extremely extensive so it covers all aspects of the feature.
6. **File the bead.** Create the epic with `bd create "<title>" --type epic --priority P1 --body-file -`, piping the rendered PRD to stdin, then run `classify-bead` (as a subagent, per its invocation instructions) to label it AFK or HITL.

Run the steps in order. Skip a step only when the user confirms it is unnecessary (e.g. the codebase is already explored).

## Red Flags

- Red flag: writing the PRD while an interview branch is still unresolved — each unanswered branch becomes a guess in the spec.
- Red flag: accepting user assertions about the codebase without verifying them in the repo.
- Red flag: a thin user-story list — a handful of stories usually means aspects of the feature were never discussed.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I have enough context — the user is impatient" | Impatience is a signal to keep questions short, not to skip them. Unresolved branches surface later as rework. |
| "The feature is simple, a few stories are enough" | An extensive story list is how hidden aspects of the feature surface; thin stories mean thin scope coverage. |
| "I know this codebase, no need to explore" | Verification in the repo is cheap; a wrong assumption becomes a wrong PRD. |

## Philosophy / rationale

- The PRD is the contract between intent and implementation; its quality caps everything downstream, so exhaust the interview before writing.
- Deep modules beat shallow ones — in code and in the PRD's implementation decisions. Interfaces worth stating are stable ones.

## Phase-gate checklist

- [ ] Gate 1 — shared understanding: every design-tree branch resolved and the user confirms the summary.
- [ ] Gate 2 — modules agreed: the module list and test expectations match the user's model of the solution.
- [ ] Gate 3 — PRD filed: the epic bead contains the rendered template and carries an implementation-type label.

## Cross-skill references

- Use `record-idea` when the idea is not yet ready to build.
- Use `write-a-ticket` when the spec targets an external tracker rather than a bead.
- Run `prd-to-tasks` on the filed epic to break the PRD into an executable backlog.
- Run `classify-bead` on the new epic — the repo labels every new bead AFK or HITL.

## Examples

Input: "Write a PRD for adding scheduled exports to the reporting feature"
Output: an epic bead whose description is the rendered PRD — problem, solution, extensive user stories, implementation and testing decisions, out-of-scope items, and further notes.

## Verification checklist

- [ ] Template in `FORMAT.md` rendered fully, with no placeholder sections.
- [ ] Every user story follows "As an <actor>, I want <feature>, so that <benefit>".
- [ ] Codebase assertions verified against the repo before writing.
- [ ] Implementation Decisions contains no file paths or code snippets.
- [ ] Epic bead filed with type `epic`, priority P1, the rendered PRD as description, and an implementation-type label applied.