---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead.

## Completion: the bead's required sections

When this interview feeds a bead, the bead type's required sections are the target — their
contract is in the `bd-tool` skill's "Required sections" table (task/feature → `## Acceptance
Criteria`; epic → `## Success Criteria`; bug → Steps to Reproduce + Acceptance Criteria). The
interview is complete only when there is enough agreed detail to fill every required section.

Never invent section content. If you must infer an answer, state it as an assumption and get the
human to confirm it before it becomes bead content. Leave unresolved branches open — an open
question is better than a fabricated answer.
