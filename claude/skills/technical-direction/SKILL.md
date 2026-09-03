---
name: technical-direction
description: Challenge assumptions, map constraints, compare options, and justify the choice. Use when deciding technical direction, choosing architecture or technology, or designing a solution with tradeoffs.
---

# Technical Direction

Act as a pragmatic, challenging staff engineer: constructive, direct, and evidence-driven. The deliverable is a justified recommendation, not consensus.

## When to use

- "Decide technical direction" for a change with real architectural weight.
- Evaluating architecture or technology choices that carry tradeoffs.
- A PRD or brief is approved and the solution shape is still open.
- "Design a solution" where alternatives need mapping and comparison before picking one.

## When NOT to use

- Stress-testing an existing plan or sharpening domain language — use `grill-with-docs`.
- Scoping a feature into PRD and tasks — use `plan` before direction makes sense.
- Exploring a codebase for refactoring opportunities — use `improve-codebase-architecture`.
- Reversible decisions with no meaningful tradeoffs — a memo costs more than it saves.

## Workflow

1. **Anchor on problem context.** Start from the PRD or user brief. Confirm goals, non-goals, and the decision horizon (how long this choice must hold).
2. **Discover constraints from the codebase first.** Investigate architecture, existing interfaces, deployment and runtime constraints, data-model boundaries, and team conventions using Grep, Read, and Glob. Record unknowns and risks explicitly.
3. **Run the challenge loop, one question at a time.** Ask focused, high-leverage questions. Challenge vague claims and hidden assumptions; require explicit justification for each major decision. Keep drilling until constraints and tradeoffs are concrete. If an answer exists in the codebase, find it before asking.
4. **Generate options.** Always include Option A (extend the current approach), Option B (moderate architectural shift), and Option C (a stronger alternative using new tech or patterns). Evaluate each on feasibility, complexity, migration cost, operational impact, testability, performance, and failure modes.
5. **Use web research when the codebase is insufficient.** Do this autonomously for high-impact decisions needing external comparison. Prefer authoritative sources (official docs, maintainers, widely adopted production guidance) via WebFetch; bring findings back as tradeoffs with source links.
6. **Converge on a recommendation.** Select the best-fit option under current constraints. Explain explicitly why each alternative was not chosen. List decision triggers that would justify revisiting.
7. **Write the decision memo.** Ensure `docs/technical-direction/` exists and save `docs/technical-direction/<feature-slug>.md` using the template in [FORMAT.md](FORMAT.md).

## Red Flags

- Red flag: proposing options before constraints are mapped — alternatives become uncomparable.
- Red flag: asking a question the codebase can answer without looking first.
- Red flag: optimising for agreement instead of surfacing hard tradeoffs.
- Red flag: recommending direction without stated tradeoffs, revisit triggers, or validation signals.
- Red flag: sliding into premature implementation details before direction is selected.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "We already know the answer" | Stated answers often rest on unstated assumptions. Test the recommendation against the constraints before accepting it. |
| "The tradeoffs are obvious" | Obvious today is forgotten in a month. The memo exists so reversible choices stay reversible and irreversible ones are signposted. |
| "Web research is overkill" | For high-impact choices with insufficient codebase evidence, external comparison is the cheapest way to kill a plausible-but-wrong option. |
| "One option is clearly right" | A single option is a statement, not a decision. Alternatives and their failure modes are what justify the choice. |

## Philosophy / rationale

- **Constraints first, options second.** Options only compare against the constraints that bound them, so map the codebase and decision horizon before generating alternatives.
- **Challenge is the deliverable.** The value of a direction session is the assumptions it surfaces and kills. Optimising for agreement produces a recommendation nobody tested.
- **Every recommendation carries its tradeoffs.** A choice without documented tradeoffs, revisit triggers, and validation signals cannot be revisited intelligently later.

## Cross-skill references

- `write-a-prd` produces the input brief when no PRD exists yet.
- `grill-with-docs` sharpens contested terminology and stress-tests the memo against domain docs.
- `design-an-interface` structures the option-generation step when the decision is about interface shape.
- `style-documentation` governs the memo's what/whether criteria before writing.

## Examples

Input: "Decide on the write-path storage for the events service."
Output: a decision memo at `docs/technical-direction/events-write-path.md` covering constraints, three options scored against them, a justified recommendation, tradeoffs accepted, a validation plan, revisit triggers, and references. See [FORMAT.md](FORMAT.md) for the full template.

## Verification checklist

- [ ] Goals, non-goals, and decision horizon confirmed before options were generated
- [ ] Codebase constraints explored before asking questions; unknowns and risks recorded
- [ ] Questions asked one at a time; nothing answerable from the codebase asked of the user
- [ ] At least three options considered, including an extend-current approach and a stronger alternative
- [ ] Each option scored on feasibility, complexity, migration cost, operational impact, testability, performance, and failure modes
- [ ] Recommendation states why alternatives were not chosen and lists revisit triggers
- [ ] Decision memo saved to `docs/technical-direction/<feature-slug>.md` using the FORMAT.md template
- [ ] Tradeoffs accepted, validation plan, and references (web and code, with links) included
- [ ] No premature implementation detail in the memo — direction only